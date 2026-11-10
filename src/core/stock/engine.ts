import { randomUUID } from "node:crypto";

import { Prisma, type StockMovementType } from "@prisma/client";

import { RuleError, type RuleStatus } from "@/core/errors/rule-error";
import { decimalString } from "@/core/money";
import { businessDate as dhakaToday } from "@/core/time/business-date";

// The stock engine (P03). Every stock movement goes through applyMovement: it keeps the balance, the moving-average cost, the lots
// of an expiry-tracked product and the ledger row in step, and tells the caller what the movement cost, so the books can be
// posted at exactly that value (invariant I3). Stock never goes negative (D5).

export class StockRuleError extends RuleError {
  constructor(message: string, status: RuleStatus = 422) {
    super(message, status);
    this.name = "StockRuleError";
  }
}

export type ConsumedLot = { lot: string; expiresOn: Date; manufacturedOn: Date | null; quantity: Prisma.Decimal };

export type MovementInput = {
  organizationId: string;
  productId: string;
  variantId?: string | null;
  branchId: string;
  warehouseId: string;
  quantity: Prisma.Decimal;
  direction: "IN" | "OUT";
  movementType: StockMovementType;
  referenceType: string;
  referenceId: string;
  userId: string;
  /**
   * What one unit costs, up to four decimals. Stock coming in blends it into the average; stock going out is valued at it.
   * Left out, a movement is valued at the current average (or, when the stock never had a cost, the product's purchase price).
   */
  unitCost?: Prisma.Decimal | null;
  /** For an OUT movement of an expiry-tracked product: take from this lot first. */
  lot?: string | null;
  /** An expiry write-off: take exactly this lot (its id), and nothing else. */
  lotId?: string | null;
  /** If given, the lots an OUT movement used up are added here (a transfer moves them on). */
  lotsOut?: ConsumedLot[];
  /** The day the movement belongs to (Dhaka): tells whether a lot is in date, and is written on the ledger row. Defaults to today. */
  businessDate?: Date;
};

export type MovementResult = {
  /** The quantity on hand after the movement. */
  onHand: Prisma.Decimal;
  /** What one unit was valued at, four decimals. */
  unitCost: Prisma.Decimal;
  /** quantity x unitCost in money, two decimals: what the books must carry for this movement. */
  totalCost: Prisma.Decimal;
};

function today() {
  return new Date(`${dhakaToday()}T00:00:00.000Z`);
}

// Stock leaving by anything except an expiry write-off (which names its own lot) uses up the lots of an expiry-tracked product,
// earliest expiry first, in the warehouse the stock leaves, so the lot list stays true.
const consumesLots: ReadonlySet<StockMovementType> = new Set(["SALE", "ADJUSTMENT", "DAMAGE", "SUPPLIER_RETURN", "TRANSFER_OUT", "TAKE_OFF"]);

async function consumeExpiryLots(tx: Prisma.TransactionClient, input: MovementInput, remainingOnHand: Prisma.Decimal, asOf: Date) {
  const scope = input.variantId ?? "";
  // A sale may only use lots that are still in date (the expiry day itself is the last day).
  // Stock that is in no lot at all (older records) stays sellable.
  const inDateOnly = input.movementType === "SALE";
  if (inDateOnly) {
    const [expired] = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal | null }>>`
      SELECT SUM(quantity) AS quantity FROM expiry_batches
      WHERE organizationId = ${input.organizationId}
        AND warehouseId = ${input.warehouseId}
        AND productId = ${input.productId}
        AND variantScope = ${scope}
        AND quantity > 0
        AND expiresOn < ${asOf}
    `;
    const expiredQuantity = new Prisma.Decimal(expired?.quantity ?? 0);
    if (remainingOnHand.lt(expiredQuantity)) {
      throw new StockRuleError(`Not enough in-date stock: ${decimalString(expiredQuantity, 4)} are past their expiry date and cannot be sold.`);
    }
  }
  const lots = await tx.$queryRaw<Array<{ id: string; quantity: Prisma.Decimal; lot: string; expiresOn: Date; manufacturedOn: Date | null }>>`
    SELECT id, quantity, lot, expiresOn, manufacturedOn FROM expiry_batches
    WHERE organizationId = ${input.organizationId}
      AND warehouseId = ${input.warehouseId}
      AND productId = ${input.productId}
      AND variantScope = ${scope}
      AND quantity > 0
      AND (${inDateOnly ? 1 : 0} = 0 OR expiresOn >= ${asOf})
    ORDER BY (lot = ${input.lot ?? ""}) DESC, expiresOn ASC, createdAt ASC
    FOR UPDATE
  `;
  let remaining = input.quantity;
  for (const lot of lots) {
    if (remaining.lte(0)) {
      break;
    }
    const available = new Prisma.Decimal(lot.quantity);
    const take = Prisma.Decimal.min(available, remaining);
    await tx.expiryBatch.updateMany({ where: { id: lot.id }, data: { quantity: available.minus(take) } });
    input.lotsOut?.push({ lot: lot.lot, expiresOn: lot.expiresOn, manufacturedOn: lot.manufacturedOn, quantity: take });
    remaining = remaining.minus(take);
  }
  // Anything left over came from stock that was never put into a lot (older records); the stock balance has already confirmed it exists.
}

/** An expiry write-off takes the named lot and only that lot. */
async function consumeLotById(tx: Prisma.TransactionClient, input: MovementInput) {
  const rows = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal }>>`
    SELECT quantity FROM expiry_batches
    WHERE id = ${input.lotId} AND organizationId = ${input.organizationId} AND warehouseId = ${input.warehouseId} AND productId = ${input.productId}
    FOR UPDATE
  `;
  if (!rows[0]) {
    throw new StockRuleError("That record was not found.", 404);
  }
  const available = new Prisma.Decimal(rows[0].quantity);
  if (input.quantity.gt(available)) {
    throw new StockRuleError("The write-off quantity is greater than the lot quantity.");
  }
  await tx.expiryBatch.updateMany({ where: { id: input.lotId as string }, data: { quantity: available.minus(input.quantity) } });
}

/**
 * Adds stock to the lots of a warehouse: tops up the same lot and expiry date, or starts a new lot. One statement, so two receipts
 * of the same lot at the same moment add up instead of one of them failing on the unique key (N14).
 */
export async function addExpiryLots(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; branchId: string; warehouseId: string; productId: string; variantId?: string | null; lots: ConsumedLot[] },
) {
  for (const lot of input.lots) {
    await tx.$executeRaw`
      INSERT INTO expiry_batches (id, organizationId, branchId, warehouseId, productId, variantId, variantScope, lot, manufacturedOn, expiresOn, quantity, createdAt, updatedAt)
      VALUES (${randomUUID()}, ${input.organizationId}, ${input.branchId}, ${input.warehouseId}, ${input.productId}, ${input.variantId ?? null}, ${input.variantId ?? ""},
              ${lot.lot}, ${lot.manufacturedOn}, ${lot.expiresOn}, ${lot.quantity}, NOW(3), NOW(3)) AS incoming
      ON DUPLICATE KEY UPDATE quantity = expiry_batches.quantity + incoming.quantity, updatedAt = NOW(3)
    `;
  }
}

/**
 * Moving-average cost after a movement. Stock coming in with a cost blends into the average by quantity; stock going out leaves it
 * alone; stock coming in with no cost keeps the average.
 */
export function nextAverageCost(input: {
  onHand: Prisma.Decimal;
  average: Prisma.Decimal | null;
  direction: "IN" | "OUT";
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
}) {
  if (input.direction === "OUT" || input.unitCost === null || input.quantity.lte(0)) {
    return input.average;
  }
  if (input.onHand.lte(0) || input.average === null) {
    return input.unitCost.toDecimalPlaces(4);
  }
  const value = input.onHand.mul(input.average).plus(input.quantity.mul(input.unitCost));
  return value.div(input.onHand.plus(input.quantity)).toDecimalPlaces(4);
}

/**
 * The cost of one unit leaving stock now: the moving average, or the product's purchase price when the stock never came in with a
 * cost (an adjustment, say). A sale is never blocked for this.
 */
export async function currentUnitCost(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; productId: string; variantId?: string | null; branchId: string; warehouseId: string },
) {
  const balance = await tx.stockBalance.findFirst({
    where: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantScope: input.variantId ?? "",
      branchId: input.branchId,
      warehouseId: input.warehouseId,
    },
    select: { averageCost: true },
  });
  if (balance?.averageCost) {
    return new Prisma.Decimal(balance.averageCost);
  }
  const product = await tx.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
    select: { purchasePrice: true },
  });
  return new Prisma.Decimal(product?.purchasePrice ?? 0).toDecimalPlaces(4);
}

/** One movement of stock: the balance, the average cost, the lots and the ledger row, together. Returns what it cost (see MovementResult). */
export async function applyMovement(tx: Prisma.TransactionClient, input: MovementInput): Promise<MovementResult> {
  const product = await tx.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId, deletedAt: null },
    select: { id: true, trackStock: true, trackExpiry: true, purchasePrice: true },
  });
  if (!product) {
    throw new StockRuleError("That record was not found.", 404);
  }
  if (!product.trackStock) {
    throw new StockRuleError("This product does not track stock.");
  }
  if (input.variantId) {
    const variant = await tx.productVariant.findFirst({
      where: { id: input.variantId, productId: product.id, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!variant) {
      throw new StockRuleError("That record was not found.", 404);
    }
  }

  const variantScope = input.variantId ?? "";
  // N21. The stock row is the pair (product, warehouse). "Look for the row, create it if it is missing" races: two first stock-ins
  // both see nothing, and one hits the unique key (READ COMMITTED) or both take a gap lock and deadlock (REPEATABLE READ). Instead
  // make sure the row exists with an INSERT that does nothing when it already does (ON DUPLICATE KEY UPDATE with no change):
  // concurrent creators wait on the unique key one after the other, none fails. Then lock the row and work on it. A row created for
  // a movement that is then refused disappears with the transaction.
  await tx.$executeRaw`
    INSERT INTO stock_balances (id, organizationId, productId, variantId, variantScope, branchId, warehouseId, quantity, updatedAt)
    VALUES (${randomUUID()}, ${input.organizationId}, ${input.productId}, ${input.variantId ?? null}, ${variantScope}, ${input.branchId}, ${input.warehouseId}, 0, NOW(3))
    ON DUPLICATE KEY UPDATE id = id
  `;
  const locked = await tx.$queryRaw<Array<{ id: string; quantity: Prisma.Decimal; averageCost: Prisma.Decimal | null }>>`
    SELECT id, quantity, averageCost FROM stock_balances
    WHERE organizationId = ${input.organizationId}
      AND productId = ${input.productId}
      AND variantScope = ${variantScope}
      AND branchId = ${input.branchId}
      AND warehouseId = ${input.warehouseId}
    FOR UPDATE
  `;
  if (!locked[0]) {
    throw new Error("The stock row was not found after it was created.");
  }
  const current = new Prisma.Decimal(locked[0].quantity);
  const average = locked[0].averageCost == null ? null : new Prisma.Decimal(locked[0].averageCost);
  const next = input.direction === "IN" ? current.plus(input.quantity) : current.minus(input.quantity);
  if (next.isNeg()) {
    throw new StockRuleError("Insufficient stock.");
  }

  // What this movement is worth: the cost it was given, else the average, else (stock that never had a cost) the purchase price.
  const unitCost = (input.unitCost ?? average ?? new Prisma.Decimal(product.purchasePrice ?? 0)).toDecimalPlaces(4);
  const totalCost = input.quantity.mul(unitCost).toDecimalPlaces(2);
  const averageCost = nextAverageCost({ onHand: current, average, direction: input.direction, quantity: input.quantity, unitCost });

  await tx.stockBalance.updateMany({ where: { id: locked[0].id }, data: { quantity: next, averageCost } });

  const day = input.businessDate ?? today();
  if (input.direction === "OUT" && input.lotId) {
    await consumeLotById(tx, input);
  } else if (input.direction === "OUT" && product.trackExpiry && consumesLots.has(input.movementType)) {
    await consumeExpiryLots(tx, input, next, day);
  }

  await tx.stockLedger.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      direction: input.direction,
      movementType: input.movementType,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      unitCost,
      totalCost,
      businessDate: day,
      userId: input.userId,
    },
  });
  return { onHand: next, unitCost, totalCost };
}
