import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { businessDate, dateOnly } from "@/core/time/business-date";
import { assertPostable } from "@/core/time/period";

import { prisma } from "@/lib/db/client";
import { occurredDate } from "@/lib/format/date";
import { allocateNumber } from "@/modules/documents/numbers";
import { writeAudit } from "@/modules/auth/audit";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, parseMoney, parseQuantity } from "@/core/money";
import { addExpiryLots, applyMovement, currentUnitCost, resolveWarehouse, StockRuleError, type ConsumedLot } from "@/modules/inventory/stock";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

export type StockLine = {
  productId: string;
  variantId?: string;
  quantity: string;
  unitCost?: string;
  lot?: string;
  manufacturedOn?: string;
  expiresOn?: string;
};

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  warehouseId?: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
};

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    return {
      ok: false,
      status: error.status,
      code: error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE",
      message: error.message,
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That stock row was updated by someone else. Try again." };
  }
  return null;
}

async function warehouseOrThrow(organizationId: string, branchId: string, warehouseId?: string) {
  const warehouse = await resolveWarehouse(organizationId, branchId, warehouseId);
  if (!warehouse) {
    throw new StockRuleError("Choose an active warehouse on the current branch.");
  }
  return warehouse;
}

function lineQuantity(line: StockLine) {
  const quantity = parseQuantity(line.quantity);
  if (!quantity) {
    throw new StockRuleError("Enter a quantity greater than zero with up to four decimals.");
  }
  const unitCost = line.unitCost === undefined ? null : parseMoney(line.unitCost);
  if (line.unitCost !== undefined && !unitCost) {
    throw new StockRuleError("Enter a unit cost with up to two decimals.");
  }
  return { quantity, unitCost };
}

async function postInbound(
  kind: "OPENING" | "OWN_STOCK",
  input: Actor & { businessDate: string; lines: StockLine[] },
) {
  const requestHash = hashPayload({ kind, businessDate: input.businessDate, warehouseId: input.warehouseId ?? null, lines: input.lines });
  try {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, {
        organizationId: input.organizationId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      await assertPostable(tx, { organizationId: input.organizationId }, input.businessDate);
      const warehouse = await warehouseOrThrow(input.organizationId, input.branchId, input.warehouseId);
      const header =
        kind === "OPENING"
          ? await tx.openingStock.create({
              data: {
                organizationId: input.organizationId,
                branchId: input.branchId,
                warehouseId: warehouse.id,
                businessDate: occurredDate(input.businessDate),
              },
            })
          : await tx.ownStockInvoice.create({
              data: {
                organizationId: input.organizationId,
                branchId: input.branchId,
                warehouseId: warehouse.id,
                businessDate: occurredDate(input.businessDate),
              },
            });
      for (const line of input.lines) {
        const parsed = lineQuantity(line);
        const product = await tx.product.findFirst({
          where: { id: line.productId, organizationId: input.organizationId, deletedAt: null },
          select: { trackExpiry: true },
        });
        if (!product) {
          throw new StockRuleError("That record was not found.", 404);
        }
        if (product.trackExpiry && (!line.lot || !line.expiresOn)) {
          throw new StockRuleError("Expiry-tracked products need a lot and an expiry date.");
        }
        await applyMovement(tx, {
          organizationId: input.organizationId,
          productId: line.productId,
          variantId: line.variantId,
          branchId: input.branchId,
          warehouseId: warehouse.id,
          quantity: parsed.quantity,
          direction: "IN",
          movementType: kind,
          referenceType: kind === "OPENING" ? "opening_stock" : "own_stock",
          referenceId: header.id,
          userId: input.userId,
          unitCost: parsed.unitCost,
        });
        if (product.trackExpiry && line.lot && line.expiresOn) {
          await tx.expiryBatch.create({
            data: {
              organizationId: input.organizationId,
              branchId: input.branchId,
              productId: line.productId,
              variantId: line.variantId ?? null,
              lot: line.lot,
              manufacturedOn: line.manufacturedOn ? occurredDate(line.manufacturedOn) : null,
              expiresOn: occurredDate(line.expiresOn),
              quantity: parsed.quantity,
            },
          });
        }
      }
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: kind === "OPENING" ? "opening_stock" : "own_stock",
        entityId: header.id,
      });
      return { id: header.id, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "create",
        module: "inventory",
        entityType: kind === "OPENING" ? "opening_stock" : "own_stock",
        entityId: data.id,
        after: { lines: input.lines.length },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    return { ok: true as const, id: data.id, replayed: data.replayed };
  } catch (error) {
    if (error instanceof RuleError && error.status === 409) {
      return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: error.message };
    }
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export function postOpeningStock(input: Actor & { businessDate: string; lines: StockLine[] }) {
  return postInbound("OPENING", input);
}

export function postOwnStock(input: Actor & { businessDate: string; lines: StockLine[] }) {
  return postInbound("OWN_STOCK", input);
}

export async function postAdjustment(
  input: Actor & { productId: string; variantId?: string; quantity: string; direction: "IN" | "OUT"; reason: string },
) {
  const requestHash = hashPayload({
    productId: input.productId,
    variantId: input.variantId ?? null,
    quantity: input.quantity,
    direction: input.direction,
    reason: input.reason,
    warehouseId: input.warehouseId ?? null,
  });
  try {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, {
        organizationId: input.organizationId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      await assertPostable(tx, { organizationId: input.organizationId }, businessDate());
      const warehouse = await warehouseOrThrow(input.organizationId, input.branchId, input.warehouseId);
      const parsed = lineQuantity({ productId: input.productId, quantity: input.quantity });
      const row = await tx.stockAdjustment.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          warehouseId: warehouse.id,
          productId: input.productId,
          variantId: input.variantId ?? null,
          quantity: parsed.quantity,
          direction: input.direction,
          reason: input.reason,
        },
      });
      await applyMovement(tx, {
        organizationId: input.organizationId,
        productId: input.productId,
        variantId: input.variantId,
        branchId: input.branchId,
        warehouseId: warehouse.id,
        quantity: parsed.quantity,
        direction: input.direction,
        movementType: "ADJUSTMENT",
        referenceType: "stock_adjustment",
        referenceId: row.id,
        userId: input.userId,
      });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "stock_adjustment",
        entityId: row.id,
      });
      return { id: row.id, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "create",
        module: "inventory",
        entityType: "stock_adjustment",
        entityId: data.id,
        after: { direction: input.direction, quantity: input.quantity },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    return { ok: true as const, id: data.id, replayed: data.replayed };
  } catch (error) {
    if (error instanceof RuleError && error.status === 409) {
      return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: error.message };
    }
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function postDamage(
  input: Actor & {
    productId: string;
    businessDate: string;
    place: string;
    lot?: string;
    purchasePrice: string;
    salePrice: string;
    discountAmount: string;
    vatAmount: string;
    quantity: string;
    reason: string;
  },
) {
  const quantity = parseQuantity(input.quantity);
  const purchasePrice = parseMoney(input.purchasePrice);
  const salePrice = parseMoney(input.salePrice);
  const discountAmount = parseMoney(input.discountAmount);
  const vatAmount = parseMoney(input.vatAmount);
  if (!quantity || !purchasePrice || !salePrice || !discountAmount || !vatAmount) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Check the quantity and money fields." };
  }
  const requestHash = hashPayload({
    productId: input.productId,
    businessDate: input.businessDate,
    place: input.place,
    lot: input.lot ?? null,
    purchasePrice: input.purchasePrice,
    salePrice: input.salePrice,
    discountAmount: input.discountAmount,
    vatAmount: input.vatAmount,
    quantity: input.quantity,
    reason: input.reason,
    warehouseId: input.warehouseId ?? null,
  });
  try {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, {
        organizationId: input.organizationId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      await assertPostable(tx, { organizationId: input.organizationId }, input.businessDate);
      const warehouse = await warehouseOrThrow(input.organizationId, input.branchId, input.warehouseId);
      const row = await tx.damageRecord.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          productId: input.productId,
          businessDate: occurredDate(input.businessDate),
          place: input.place,
          lot: input.lot ?? null,
          purchasePrice,
          salePrice,
          discountAmount,
          vatAmount,
          quantity,
          reason: input.reason,
          userId: input.userId,
        },
      });
      await applyMovement(tx, {
        organizationId: input.organizationId,
        productId: input.productId,
        branchId: input.branchId,
        warehouseId: warehouse.id,
        quantity,
        direction: "OUT",
        movementType: "DAMAGE",
        referenceType: "damage_record",
        referenceId: row.id,
        userId: input.userId,
        unitCost: purchasePrice,
        lot: input.lot,
      });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "damage_record",
        entityId: row.id,
      });
      return { id: row.id, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "create",
        module: "inventory",
        entityType: "damage_record",
        entityId: data.id,
        after: { quantity: input.quantity },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    return { ok: true as const, id: data.id, replayed: data.replayed };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function listExpiry(input: {
  organizationId: string;
  branchId: string;
  productId?: string;
  barcode?: string;
  brandId?: string;
  categoryId?: string;
  generic?: string;
  lot?: string;
}) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.expiryBatch.findMany({
    where: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      productId: input.productId,
      lot: input.lot ? { contains: input.lot } : undefined,
      product: {
        deletedAt: null,
        brandId: input.brandId,
        categoryId: input.categoryId,
        category: input.generic ? { name: { contains: input.generic } } : undefined,
        barcodes: input.barcode ? { some: { barcode: input.barcode } } : undefined,
      },
    },
    orderBy: { expiresOn: "asc" },
    take: 200,
    include: { product: { select: { name: true, sku: true, category: { select: { name: true } } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    sku: row.product.sku,
    name: row.product.name,
    category: row.product.category?.name ?? "",
    lot: row.lot,
    quantity: decimalString(row.quantity, 4),
    manufacturedOn: row.manufacturedOn ? dateOnly(row.manufacturedOn) : null,
    expiresOn: dateOnly(row.expiresOn),
    status: row.expiresOn < today ? "EXPIRED" : "IN_DATE",
  }));
}

export async function writeOffExpiry(input: Actor & { batchId: string; quantity: string }) {
  const quantity = parseQuantity(input.quantity);
  if (!quantity) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a quantity greater than zero." };
  }
  const requestHash = hashPayload({ batchId: input.batchId, quantity: input.quantity, warehouseId: input.warehouseId ?? null });
  try {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, {
        organizationId: input.organizationId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      const batch = await tx.expiryBatch.findFirst({
        where: { id: input.batchId, organizationId: input.organizationId, branchId: input.branchId },
      });
      if (!batch) {
        throw new StockRuleError("That record was not found.", 404);
      }
      if (existing) {
        return { id: batch.id, quantity: decimalString(batch.quantity, 4), replayed: true };
      }
      await assertPostable(tx, { organizationId: input.organizationId }, businessDate());
      if (quantity.gt(batch.quantity)) {
        throw new StockRuleError("The write-off quantity is greater than the lot quantity.");
      }
      const warehouse = await warehouseOrThrow(input.organizationId, input.branchId, input.warehouseId);
      await applyMovement(tx, {
        organizationId: input.organizationId,
        productId: batch.productId,
        variantId: batch.variantId,
        branchId: input.branchId,
        warehouseId: warehouse.id,
        quantity,
        direction: "OUT",
        movementType: "EXPIRY",
        referenceType: "expiry_batch",
        referenceId: batch.id,
        userId: input.userId,
      });
      await tx.expiryBatch.update({ where: { id: batch.id }, data: { quantity: batch.quantity.minus(quantity) } });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "expiry_writeoff",
        entityId: batch.id,
      });
      return { id: batch.id, quantity: decimalString(batch.quantity.minus(quantity), 4), replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "update",
        module: "inventory",
        entityType: "expiry_batch",
        entityId: data.id,
        after: { quantity: input.quantity },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    return { ok: true as const, ...data };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

function day(value: Date) {
  return dateOnly(value);
}

export async function listDamageRecords(organizationId: string, branchId: string) {
  const rows = await prisma.damageRecord.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: {
      id: true,
      businessDate: true,
      place: true,
      lot: true,
      quantity: true,
      reason: true,
      product: { select: { sku: true, name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    businessDate: day(row.businessDate),
    place: row.place,
    lot: row.lot ?? "",
    quantity: decimalString(row.quantity, 4),
    reason: row.reason,
    sku: row.product.sku,
    name: row.product.name,
  }));
}

export async function listOpeningInvoices(organizationId: string, branchId: string) {
  const rows = await prisma.openingStock.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: { id: true, number: true, businessDate: true, warehouse: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number ?? "",
    businessDate: day(row.businessDate),
    warehouseName: row.warehouse.name,
  }));
}

export async function listOwnInvoices(organizationId: string, branchId: string) {
  const rows = await prisma.ownStockInvoice.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: { id: true, number: true, businessDate: true, warehouse: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number ?? "",
    businessDate: day(row.businessDate),
    warehouseName: row.warehouse.name,
  }));
}

export async function postTransfer(
  input: {
    organizationId: string;
    userId: string;
    fromBranchId: string;
    toBranchId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    lines: { productId: string; variantId?: string; quantity: string }[];
    idempotencyKey: string;
    ip: string;
    userAgent: string | null;
  },
) {
  if (input.fromWarehouseId === input.toWarehouseId) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Choose a different destination warehouse." };
  }
  if (input.lines.length === 0) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Add a product to transfer." };
  }
  const requestHash = hashPayload({
    fromBranchId: input.fromBranchId,
    toBranchId: input.toBranchId,
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    lines: input.lines,
  });
  try {
    // A transfer is received the moment it is posted (BUSINESS_RULES section 8, option A):
    // stock leaves the source and reaches the destination in one transaction, never in transit.
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        const stored = await tx.stockTransfer.findFirst({
          where: { id: existing.entityId, organizationId: input.organizationId },
          select: { id: true, number: true },
        });
        return { id: existing.entityId, number: stored?.number ?? null, replayed: true };
      }
      await assertPostable(tx, { organizationId: input.organizationId }, businessDate());
      const fromWarehouse = await tx.warehouse.findFirst({
        where: { id: input.fromWarehouseId, organizationId: input.organizationId, branchId: input.fromBranchId, status: "ACTIVE" },
        select: { id: true },
      });
      const toWarehouse = await tx.warehouse.findFirst({
        where: { id: input.toWarehouseId, organizationId: input.organizationId, branchId: input.toBranchId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!fromWarehouse || !toWarehouse) {
        throw new StockRuleError("Choose an active warehouse on each branch.", 404);
      }
      const number = await allocateNumber(tx, {
        organizationId: input.organizationId,
        documentType: "TRF",
        year: new Date().getUTCFullYear(),
      });
      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId: input.organizationId,
          number,
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          fromWarehouseId: fromWarehouse.id,
          toWarehouseId: toWarehouse.id,
          status: "RECEIVED",
          createdById: input.userId,
        },
        select: { id: true },
      });
      for (const line of input.lines) {
        const quantity = parseQuantity(line.quantity);
        if (!quantity) {
          throw new StockRuleError("Enter a quantity greater than zero.");
        }
        const product = await tx.product.findFirst({
          where: { id: line.productId, organizationId: input.organizationId, deletedAt: null },
          select: { id: true },
        });
        if (!product) {
          throw new StockRuleError("That record was not found.", 404);
        }
        // The goods move at what they cost the source, so the destination's average blends it in.
        const unitCost = await currentUnitCost(tx, {
          organizationId: input.organizationId,
          productId: product.id,
          variantId: line.variantId,
          branchId: input.fromBranchId,
          warehouseId: fromWarehouse.id,
        });
        await tx.stockTransferItem.create({
          data: { organizationId: input.organizationId, transferId: transfer.id, productId: product.id, variantId: line.variantId ?? null, quantity },
        });
        const lots: ConsumedLot[] = [];
        await applyMovement(tx, {
          organizationId: input.organizationId,
          productId: product.id,
          variantId: line.variantId,
          branchId: input.fromBranchId,
          warehouseId: fromWarehouse.id,
          quantity,
          direction: "OUT",
          movementType: "TRANSFER_OUT",
          referenceType: "stock_transfer",
          referenceId: transfer.id,
          userId: input.userId,
          unitCost,
          lotsOut: lots,
        });
        await applyMovement(tx, {
          organizationId: input.organizationId,
          productId: product.id,
          variantId: line.variantId,
          branchId: input.toBranchId,
          warehouseId: toWarehouse.id,
          quantity,
          direction: "IN",
          movementType: "TRANSFER_IN",
          referenceType: "stock_transfer",
          referenceId: transfer.id,
          userId: input.userId,
          unitCost,
        });
        if (lots.length > 0) {
          await addExpiryLots(tx, {
            organizationId: input.organizationId,
            branchId: input.toBranchId,
            productId: product.id,
            variantId: line.variantId,
            lots,
          });
        }
      }
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "stock_transfer",
        entityId: transfer.id,
      });
      return { id: transfer.id, number, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.fromBranchId,
        userId: input.userId,
        action: "create",
        module: "inventory",
        entityType: "stock_transfer",
        entityId: data.id,
        after: { number: data.number, toBranchId: input.toBranchId },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    return { ok: true as const, id: data.id, number: data.number, replayed: data.replayed };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}
