import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { hashPayload, readIdempotency, saveIdempotency } from "@/modules/inventory/idempotency";
import { decimalString, parseMoney, parseQuantity } from "@/modules/inventory/money";
import { applyMovement, resolveWarehouse, StockRuleError } from "@/modules/inventory/stock";

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
  if (error instanceof StockRuleError) {
    return {
      ok: false,
      status: error.status,
      code: error.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE",
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
  input: Actor & { occurredOn: string; lines: StockLine[] },
) {
  const requestHash = hashPayload({ kind, occurredOn: input.occurredOn, warehouseId: input.warehouseId ?? null, lines: input.lines });
  try {
    const data = await prisma.$transaction(async (tx) => {
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
      const warehouse = await warehouseOrThrow(input.organizationId, input.branchId, input.warehouseId);
      const header =
        kind === "OPENING"
          ? await tx.openingStock.create({
              data: {
                organizationId: input.organizationId,
                branchId: input.branchId,
                warehouseId: warehouse.id,
                occurredOn: new Date(input.occurredOn),
              },
            })
          : await tx.ownStockInvoice.create({
              data: {
                organizationId: input.organizationId,
                branchId: input.branchId,
                warehouseId: warehouse.id,
                occurredOn: new Date(input.occurredOn),
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
              manufacturedOn: line.manufacturedOn ? new Date(line.manufacturedOn) : null,
              expiresOn: new Date(line.expiresOn),
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
    if (error instanceof StockRuleError && error.status === 409) {
      return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: error.message };
    }
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export function postOpeningStock(input: Actor & { occurredOn: string; lines: StockLine[] }) {
  return postInbound("OPENING", input);
}

export function postOwnStock(input: Actor & { occurredOn: string; lines: StockLine[] }) {
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
    const data = await prisma.$transaction(async (tx) => {
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
    if (error instanceof StockRuleError && error.status === 409) {
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
    occurredOn: string;
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
  try {
    const data = await prisma.$transaction(async (tx) => {
      const warehouse = await warehouseOrThrow(input.organizationId, input.branchId, input.warehouseId);
      const row = await tx.damageRecord.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          productId: input.productId,
          occurredOn: new Date(input.occurredOn),
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
      });
      return { id: row.id };
    });
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
    return { ok: true as const, id: data.id };
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
    manufacturedOn: row.manufacturedOn?.toISOString().slice(0, 10) ?? null,
    expiresOn: row.expiresOn.toISOString().slice(0, 10),
    status: row.expiresOn < today ? "EXPIRED" : "IN_DATE",
  }));
}

export async function writeOffExpiry(input: Actor & { batchId: string; quantity: string }) {
  const quantity = parseQuantity(input.quantity);
  if (!quantity) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a quantity greater than zero." };
  }
  try {
    const data = await prisma.$transaction(async (tx) => {
      const batch = await tx.expiryBatch.findFirst({
        where: { id: input.batchId, organizationId: input.organizationId, branchId: input.branchId },
      });
      if (!batch) {
        throw new StockRuleError("That record was not found.", 404);
      }
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
      return { id: batch.id, quantity: decimalString(batch.quantity.minus(quantity), 4) };
    });
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
  return value.toISOString().slice(0, 10);
}

export async function listDamageRecords(organizationId: string, branchId: string) {
  const rows = await prisma.damageRecord.findMany({
    where: { organizationId, branchId },
    orderBy: { occurredOn: "desc" },
    take: 100,
    select: {
      id: true,
      occurredOn: true,
      place: true,
      lot: true,
      quantity: true,
      reason: true,
      product: { select: { sku: true, name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    occurredOn: day(row.occurredOn),
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
    orderBy: { occurredOn: "desc" },
    take: 100,
    select: { id: true, number: true, occurredOn: true, warehouse: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number ?? "",
    occurredOn: day(row.occurredOn),
    warehouseName: row.warehouse.name,
  }));
}

export async function listOwnInvoices(organizationId: string, branchId: string) {
  const rows = await prisma.ownStockInvoice.findMany({
    where: { organizationId, branchId },
    orderBy: { occurredOn: "desc" },
    take: 100,
    select: { id: true, number: true, occurredOn: true, warehouse: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number ?? "",
    occurredOn: day(row.occurredOn),
    warehouseName: row.warehouse.name,
  }));
}

export async function postTransfer(input: {
  organizationId: string;
  userId: string;
  fromBranchId: string;
  toBranchId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  lines: { productId: string; quantity: string }[];
  ip: string;
  userAgent: string | null;
}) {
  if (input.fromWarehouseId === input.toWarehouseId) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Choose a different destination warehouse." };
  }
  if (input.lines.length === 0) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Add a product to transfer." };
  }
  try {
    const transferId = await prisma.$transaction(async (tx) => {
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
      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId: input.organizationId,
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
        const ins = await tx.stockLedger.findMany({
          where: {
            organizationId: input.organizationId,
            productId: product.id,
            variantId: null,
            branchId: input.fromBranchId,
            warehouseId: fromWarehouse.id,
            direction: "IN",
          },
          select: { unitCost: true, quantity: true },
        });
        if (ins.length === 0 || ins.some((row) => row.unitCost === null)) {
          throw new StockRuleError("This stock has no unit cost to transfer.");
        }
        let qty = new Prisma.Decimal(0);
        let amount = new Prisma.Decimal(0);
        for (const row of ins) {
          const rowQuantity = new Prisma.Decimal(row.quantity);
          qty = qty.plus(rowQuantity);
          amount = amount.plus(rowQuantity.mul(row.unitCost ?? 0));
        }
        const unitCost = qty.lte(0) ? null : amount.div(qty);
        if (!unitCost) {
          throw new StockRuleError("This stock has no unit cost to transfer.");
        }
        await tx.stockTransferItem.create({
          data: { organizationId: input.organizationId, transferId: transfer.id, productId: product.id, quantity },
        });
        await applyMovement(tx, {
          organizationId: input.organizationId,
          productId: product.id,
          branchId: input.fromBranchId,
          warehouseId: fromWarehouse.id,
          quantity,
          direction: "OUT",
          movementType: "TRANSFER_OUT",
          referenceType: "stock_transfer",
          referenceId: transfer.id,
          userId: input.userId,
          unitCost,
        });
        await applyMovement(tx, {
          organizationId: input.organizationId,
          productId: product.id,
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
      }
      return transfer.id;
    });
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "create",
      module: "inventory",
      entityType: "stock_transfer",
      entityId: transferId,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true as const, id: transferId };
  } catch (error) {
    if (error instanceof StockRuleError) {
      const code = error.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE";
      return { ok: false as const, status: error.status, code, message: error.message };
    }
    throw error;
  }
}

export function rejectTransfer() {
  return {
    ok: false as const,
    status: 422 as const,
    code: "BUSINESS_RULE" as const,
    message: "Stock transfers are not available until the in-transit rule is approved.",
  };
}
