import { Prisma, type StockDocumentType, type TakeOffPurpose } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { businessDate, dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { occurredDate } from "@/lib/format/date";
import { allocateNumber } from "@/modules/documents/numbers";
import { writeAudit } from "@/modules/auth/audit";
import { hashPayload, idempotentTransaction, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, parseQuantity } from "@/core/money";
import { postWithStock, type MovedStock, type StockMove } from "@/core/posting/stock";
import type { DocType, PostLine } from "@/core/posting/journal";
import { addSerials, cleanSerials, requireSerialPerUnit } from "@/core/stock";
import { addExpiryLots, resolveWarehouse, StockRuleError, type ConsumedLot } from "@/modules/inventory/stock";

// The stock documents (P03 task 4): opening, own stock, adjustment, damage, expiry write-off, take-off and transfer. Each one is a
// header (stock_documents, or stock_transfers) and, through the posting engine, its stock movements and its journal together,
// valued at the average cost (I3). Nothing here writes the stock ledger, the stock balance or a journal: postWithStock does.

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

export type StockLine = {
  productId: string;
  variantId?: string;
  quantity: string;
  /** What one unit costs, up to four decimals. Left out, the stock is valued at the average. */
  unitCost?: string;
  lot?: string;
  manufacturedOn?: string;
  expiresOn?: string;
  /** For a serial-tracked product: one IMEI or serial for each unit. */
  serials?: string[];
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

const ZERO = new Prisma.Decimal(0);

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    return {
      ok: false,
      status: error.status,
      code: error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE",
      message: error.message,
    };
  }
  if (isKeyRace(error)) {
    throw error;
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

/** A unit cost: zero or more, up to four decimals. */
function parseCost(value: string | undefined) {
  if (value === undefined) {
    return null;
  }
  if (!/^\d{1,14}(\.\d{1,4})?$/.test(value.trim())) {
    throw new StockRuleError("Enter a unit cost with up to four decimals.");
  }
  return new Prisma.Decimal(value.trim());
}

function lineQuantity(line: { quantity: string; unitCost?: string }) {
  const quantity = parseQuantity(line.quantity);
  if (!quantity) {
    throw new StockRuleError("Enter a quantity greater than zero with up to four decimals.");
  }
  return { quantity, unitCost: parseCost(line.unitCost) };
}

type Built = {
  moves: StockMove[];
  /** The journal lines, from what the movements cost. Empty when the books do not change. */
  lines: (moved: MovedStock) => PostLine[];
  /** Runs after the movements: lots of the stock that came in. */
  after?: (tx: Prisma.TransactionClient, moved: MovedStock) => Promise<void>;
};

type Spec = {
  kind: StockDocumentType;
  docType: DocType;
  entityType: string;
  hash: Record<string, unknown>;
  businessDate: string;
  header?: { reason?: string; place?: string; takeOffPurpose?: TakeOffPurpose; recipient?: string; approvedBy?: string; note?: string; expenseAccountId?: string };
  describe: (number: string) => string;
  /** The warehouse the document is in, when it is not the one the caller named (an expiry write-off is in its lot's warehouse). */
  warehouseOf?: (tx: Prisma.TransactionClient) => Promise<string>;
  build: (tx: Prisma.TransactionClient, warehouseId: string) => Promise<Built>;
  audit?: Record<string, unknown>;
};

const bothSides = (debit: PostLine, credit: PostLine) => [debit, credit];

/** One stock document, start to finish: idempotency, number, header, movements and journal, audit. */
async function postStockDocument(input: Actor, spec: Spec) {
  const requestHash = hashPayload({ kind: spec.kind, businessDate: spec.businessDate, warehouseId: input.warehouseId ?? null, ...spec.hash });
  try {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const warehouseId = spec.warehouseOf ? await spec.warehouseOf(tx) : (await warehouseOrThrow(input.organizationId, input.branchId, input.warehouseId)).id;
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "STK", businessDate: spec.businessDate });
      const header = await tx.stockDocument.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          warehouseId,
          type: spec.kind,
          number,
          businessDate: occurredDate(spec.businessDate),
          createdById: input.userId,
          ...spec.header,
        },
        select: { id: true },
      });
      const built = await spec.build(tx, warehouseId);
      const { journalId, moved } = await postWithStock(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(spec.businessDate),
        description: spec.describe(number),
        createdById: input.userId,
        doc: { type: spec.docType, id: header.id },
        reference: { type: "stock_document", id: header.id },
        moves: built.moves,
        lines: built.lines,
      });
      if (journalId) {
        await tx.stockDocument.update({ where: { id: header.id }, data: { journalId } });
      }
      await built.after?.(tx, moved);
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: spec.entityType,
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
        entityType: spec.entityType,
        entityId: data.id,
        after: spec.audit as Prisma.InputJsonObject | undefined,
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

// --- stock coming in: opening and own stock ---

function inbound(kind: "OPENING" | "OWN", input: Actor & { businessDate: string; lines: StockLine[] }) {
  const movementType = kind === "OPENING" ? "OPENING" : "OWN_STOCK";
  return postStockDocument(input, {
    kind,
    docType: kind === "OPENING" ? "OPENING_STOCK" : "OWN_STOCK",
    entityType: kind === "OPENING" ? "opening_stock" : "own_stock",
    hash: { lines: input.lines },
    businessDate: input.businessDate,
    describe: (number) => `${kind === "OPENING" ? "Opening stock" : "Own stock"} ${number}`,
    audit: { lines: input.lines.length },
    build: async (tx, warehouseId) => {
      const moves: StockMove[] = [];
      const serialLines: Array<{ index: number; productId: string; variantId?: string; serials: string[] }> = [];
      const lots: Array<{ productId: string; variantId?: string; lot: ConsumedLot }> = [];
      for (const line of input.lines) {
        const parsed = lineQuantity(line);
        const product = await tx.product.findFirst({
          where: { id: line.productId, organizationId: input.organizationId, deletedAt: null },
          select: { trackExpiry: true, trackSerial: true },
        });
        if (!product) {
          throw new StockRuleError("That record was not found.", 404);
        }
        if (product.trackExpiry && (!line.lot || !line.expiresOn)) {
          throw new StockRuleError("Expiry-tracked products need a lot and an expiry date.");
        }
        const serials = cleanSerials(line.serials);
        if (product.trackSerial) {
          requireSerialPerUnit(parsed.quantity, serials);
        } else if (serials.length > 0) {
          throw new StockRuleError("This product does not track serial numbers.");
        }
        serialLines.push({ index: moves.length, productId: line.productId, variantId: line.variantId, serials });
        moves.push({ productId: line.productId, variantId: line.variantId, warehouseId, quantity: parsed.quantity, direction: "IN", movementType, unitCost: parsed.unitCost });
        if (product.trackExpiry && line.lot && line.expiresOn) {
          lots.push({
            productId: line.productId,
            variantId: line.variantId,
            lot: { lot: line.lot, manufacturedOn: line.manufacturedOn ? occurredDate(line.manufacturedOn) : null, expiresOn: occurredDate(line.expiresOn), quantity: parsed.quantity },
          });
        }
      }
      const counter = kind === "OPENING" ? ("OPENING_EQUITY" as const) : ("CAPITAL" as const);
      return {
        moves,
        lines: (moved) => (moved.in.gt(0) ? bothSides({ role: "INVENTORY", debit: moved.in, credit: ZERO }, { role: counter, debit: ZERO, credit: moved.in }) : []),
        after: async (tx, moved) => {
          for (const entry of serialLines) {
            if (entry.serials.length > 0) {
              await addSerials(tx, { organizationId: input.organizationId, productId: entry.productId, variantId: entry.variantId, warehouseId, serials: entry.serials, inMovementId: moved.results[entry.index].ledgerId });
            }
          }
          for (const entry of lots) {
            await addExpiryLots(tx, { organizationId: input.organizationId, branchId: input.branchId, warehouseId, productId: entry.productId, variantId: entry.variantId, lots: [entry.lot] });
          }
        },
      };
    },
  });
}

export function postOpeningStock(input: Actor & { businessDate: string; lines: StockLine[] }) {
  return inbound("OPENING", input);
}

export function postOwnStock(input: Actor & { businessDate: string; lines: StockLine[] }) {
  return inbound("OWN", input);
}

// --- stock going out or corrected: adjustment, damage, expiry, take-off ---

/** The loss lines: Dr Inventory Loss (or the chosen account) / Cr Inventory, at what the stock cost. */
const outLines = (debitAccount: { role: "INVENTORY_LOSS" | "DRAWINGS" | "MISC" } | { accountId: string }) => (moved: MovedStock): PostLine[] =>
  moved.out.gt(0)
    ? bothSides({ ...debitAccount, debit: moved.out, credit: ZERO } as PostLine, { role: "INVENTORY", debit: ZERO, credit: moved.out })
    : [];

export function postAdjustment(
  input: Actor & { productId: string; variantId?: string; quantity: string; direction: "IN" | "OUT"; reason: string; businessDate?: string },
) {
  const day = input.businessDate ?? businessDate();
  return postStockDocument(input, {
    kind: "ADJUST",
    docType: "STOCK_ADJUSTMENT",
    entityType: "stock_adjustment",
    hash: { productId: input.productId, variantId: input.variantId ?? null, quantity: input.quantity, direction: input.direction, reason: input.reason },
    businessDate: day,
    header: { reason: input.reason },
    describe: (number) => `Stock adjustment ${number}`,
    audit: { direction: input.direction, quantity: input.quantity },
    build: async (_tx, warehouseId) => {
      const parsed = lineQuantity({ quantity: input.quantity });
      return {
        moves: [{ productId: input.productId, variantId: input.variantId, warehouseId, quantity: parsed.quantity, direction: input.direction, movementType: "ADJUSTMENT" }],
        lines: (moved) =>
          input.direction === "IN"
            ? moved.in.gt(0) ? bothSides({ role: "INVENTORY", debit: moved.in, credit: ZERO }, { role: "INVENTORY_GAIN", debit: ZERO, credit: moved.in }) : []
            : outLines({ role: "INVENTORY_LOSS" })(moved),
      };
    },
  });
}

export function postDamage(
  input: Actor & {
    productId: string;
    businessDate: string;
    place: string;
    lot?: string;
    /** The prices on the form are for the record only: the loss is valued at the average cost. */
    purchasePrice: string;
    salePrice: string;
    discountAmount: string;
    vatAmount: string;
    quantity: string;
    reason: string;
  },
) {
  return postStockDocument(input, {
    kind: "DAMAGE",
    docType: "DAMAGE",
    entityType: "damage_record",
    hash: { productId: input.productId, place: input.place, lot: input.lot ?? null, quantity: input.quantity, reason: input.reason },
    businessDate: input.businessDate,
    header: { reason: input.reason, place: input.place, note: input.lot ? `Lot ${input.lot}` : undefined },
    describe: (number) => `Damage ${number}`,
    audit: { quantity: input.quantity },
    build: async (_tx, warehouseId) => {
      const parsed = lineQuantity({ quantity: input.quantity });
      return {
        moves: [{ productId: input.productId, warehouseId, quantity: parsed.quantity, direction: "OUT", movementType: "DAMAGE", lot: input.lot }],
        lines: outLines({ role: "INVENTORY_LOSS" }),
      };
    },
  });
}

export async function writeOffExpiry(input: Actor & { batchId: string; quantity: string }) {
  const done = await postStockDocument(input, {
    kind: "EXPIRY",
    docType: "EXPIRY_WRITEOFF",
    entityType: "expiry_writeoff",
    hash: { batchId: input.batchId, quantity: input.quantity },
    businessDate: businessDate(),
    describe: (number) => `Expiry write-off ${number}`,
    audit: { quantity: input.quantity },
    warehouseOf: async (tx) => {
      const batch = await tx.expiryBatch.findFirst({ where: { id: input.batchId, organizationId: input.organizationId, branchId: input.branchId }, select: { warehouseId: true } });
      if (!batch) {
        throw new StockRuleError("That record was not found.", 404);
      }
      return batch.warehouseId;
    },
    build: async (tx, warehouseId) => {
      const quantity = parseQuantity(input.quantity);
      if (!quantity) {
        throw new StockRuleError("Enter a quantity greater than zero.");
      }
      const batch = await tx.expiryBatch.findFirstOrThrow({ where: { id: input.batchId, organizationId: input.organizationId } });
      return {
        moves: [{ productId: batch.productId, variantId: batch.variantId, warehouseId, quantity, direction: "OUT", movementType: "EXPIRY", lotId: batch.id }],
        lines: outLines({ role: "INVENTORY_LOSS" }),
      };
    },
  });
  if (!done.ok) {
    return done;
  }
  const batch = await prisma.expiryBatch.findFirst({ where: { id: input.batchId, organizationId: input.organizationId }, select: { quantity: true } });
  return { ok: true as const, id: input.batchId, quantity: decimalString(batch?.quantity ?? ZERO, 4), replayed: done.replayed };
}

export const TAKE_OFF_PURPOSES: readonly TakeOffPurpose[] = ["SAMPLE", "DEMO", "FIELD_TRIAL", "OWN_USE", "GIFT"];

/**
 * Take-off (D1): goods leave the warehouse without a sale. The owner's own use is a drawing; the other purposes are an expense, in
 * the account chosen or the general expense account. Always at the average cost.
 */
export function postTakeOff(
  input: Actor & {
    businessDate: string;
    purpose: TakeOffPurpose;
    recipient: string;
    approvedBy: string;
    note?: string;
    expenseAccountId?: string;
    lines: Array<{ productId: string; variantId?: string; quantity: string; lot?: string }>;
  },
) {
  return postStockDocument(input, {
    kind: "TAKE_OFF",
    docType: "TAKE_OFF",
    entityType: "take_off",
    hash: { purpose: input.purpose, recipient: input.recipient, approvedBy: input.approvedBy, note: input.note ?? null, expenseAccountId: input.expenseAccountId ?? null, lines: input.lines },
    businessDate: input.businessDate,
    header: { takeOffPurpose: input.purpose, recipient: input.recipient, approvedBy: input.approvedBy, note: input.note, expenseAccountId: input.expenseAccountId },
    describe: (number) => `Take-off ${number}`,
    audit: { purpose: input.purpose, lines: input.lines.length },
    build: async (_tx, warehouseId) => {
      if (!TAKE_OFF_PURPOSES.includes(input.purpose)) {
        throw new StockRuleError("Choose why the goods are taken off.");
      }
      if (input.lines.length === 0) {
        throw new StockRuleError("Add a product to take off.");
      }
      const moves: StockMove[] = input.lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        warehouseId,
        quantity: lineQuantity({ quantity: line.quantity }).quantity,
        direction: "OUT",
        movementType: "TAKE_OFF",
        lot: line.lot,
      }));
      const debit = input.purpose === "OWN_USE" ? { role: "DRAWINGS" as const } : input.expenseAccountId ? { accountId: input.expenseAccountId } : { role: "MISC" as const };
      return { moves, lines: outLines(debit) };
    },
  });
}

// --- lists ---

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
    include: { product: { select: { name: true, sku: true, category: { select: { name: true } } } }, warehouse: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    sku: row.product.sku,
    name: row.product.name,
    category: row.product.category?.name ?? "",
    warehouseName: row.warehouse.name,
    lot: row.lot,
    quantity: decimalString(row.quantity, 4),
    manufacturedOn: row.manufacturedOn ? dateOnly(row.manufacturedOn) : null,
    expiresOn: dateOnly(row.expiresOn),
    status: row.expiresOn < today ? "EXPIRED" : "IN_DATE",
  }));
}

function day(value: Date) {
  return dateOnly(value);
}

export async function listDamageRecords(organizationId: string, branchId: string) {
  const docs = await prisma.stockDocument.findMany({
    where: { organizationId, branchId, type: "DAMAGE" },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: { id: true, businessDate: true, place: true, note: true, reason: true },
  });
  const moves = docs.length === 0 ? [] : await prisma.stockLedger.findMany({ where: { organizationId, referenceId: { in: docs.map((doc) => doc.id) } }, select: { referenceId: true, quantity: true, product: { select: { sku: true, name: true } } } });
  const byDoc = new Map(moves.map((move) => [move.referenceId, move]));
  return docs.map((doc) => {
    const move = byDoc.get(doc.id);
    return {
      id: doc.id,
      businessDate: day(doc.businessDate),
      place: doc.place ?? "",
      lot: doc.note?.replace(/^Lot /, "") ?? "",
      quantity: decimalString(move?.quantity ?? ZERO, 4),
      reason: doc.reason ?? "",
      sku: move?.product.sku ?? "",
      name: move?.product.name ?? "",
    };
  });
}

async function listHeaders(organizationId: string, branchId: string, type: StockDocumentType) {
  const rows = await prisma.stockDocument.findMany({
    where: { organizationId, branchId, type },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: { id: true, number: true, businessDate: true, warehouse: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, number: row.number ?? "", businessDate: day(row.businessDate), warehouseName: row.warehouse.name }));
}

export const listOpeningInvoices = (organizationId: string, branchId: string) => listHeaders(organizationId, branchId, "OPENING");

export const listOwnInvoices = (organizationId: string, branchId: string) => listHeaders(organizationId, branchId, "OWN");

/** Take-offs, newest first, with what they took and what it was worth. */
export async function listTakeOffs(organizationId: string, branchId: string, take = 100) {
  const docs = await prisma.stockDocument.findMany({
    where: { organizationId, branchId, type: "TAKE_OFF" },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take,
  });
  const moves = docs.length === 0 ? [] : await prisma.stockLedger.findMany({
    where: { organizationId, referenceType: "stock_document", referenceId: { in: docs.map((doc) => doc.id) } },
    select: { referenceId: true, quantity: true, totalCost: true, product: { select: { sku: true, name: true } } },
  });
  return docs.map((doc) => {
    const mine = moves.filter((move) => move.referenceId === doc.id);
    return {
      id: doc.id,
      number: doc.number ?? "",
      businessDate: day(doc.businessDate),
      purpose: doc.takeOffPurpose,
      recipient: doc.recipient ?? "",
      approvedBy: doc.approvedBy ?? "",
      note: doc.note ?? "",
      value: decimalString(mine.reduce((total, move) => total.plus(move.totalCost ?? ZERO), ZERO), 2),
      items: mine.map((move) => ({ sku: move.product.sku, name: move.product.name, quantity: decimalString(move.quantity, 4) })),
    };
  });
}

// --- transfer ---

export async function postTransfer(input: {
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
}) {
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
    // A transfer is received the moment it is posted (BUSINESS_RULES section 8, option A): stock leaves the source and reaches the
    // destination in one transaction, never in transit. The goods move at what they cost the source, so the destination's average
    // blends it in, and the inventory account of each branch moves by its own side.
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        const stored = await tx.stockTransfer.findFirst({ where: { id: existing.entityId, organizationId: input.organizationId }, select: { id: true, number: true } });
        return { id: existing.entityId, number: stored?.number ?? null, replayed: true };
      }
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
      const today = businessDate();
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "TRF", businessDate: today });
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
      const moves: StockMove[] = [];
      const consumed: Array<{ lots: ConsumedLot[]; productId: string; variantId?: string }> = [];
      for (const line of input.lines) {
        const quantity = parseQuantity(line.quantity);
        if (!quantity) {
          throw new StockRuleError("Enter a quantity greater than zero.");
        }
        const product = await tx.product.findFirst({ where: { id: line.productId, organizationId: input.organizationId, deletedAt: null }, select: { id: true } });
        if (!product) {
          throw new StockRuleError("That record was not found.", 404);
        }
        await tx.stockTransferItem.create({
          data: { organizationId: input.organizationId, transferId: transfer.id, productId: product.id, variantId: line.variantId ?? null, quantity },
        });
        const lots: ConsumedLot[] = [];
        consumed.push({ lots, productId: product.id, variantId: line.variantId });
        const out = moves.push({ productId: product.id, variantId: line.variantId, warehouseId: fromWarehouse.id, quantity, direction: "OUT", movementType: "TRANSFER_OUT", lotsOut: lots }) - 1;
        moves.push({ productId: product.id, variantId: line.variantId, warehouseId: toWarehouse.id, branchId: input.toBranchId, quantity, direction: "IN", movementType: "TRANSFER_IN", unitCostFrom: out });
      }
      await postWithStock(tx, {
        organizationId: input.organizationId,
        branchId: input.fromBranchId,
        businessDate: occurredDate(today),
        description: `Stock transfer ${number}`,
        createdById: input.userId,
        doc: { type: "TRANSFER", id: transfer.id },
        reference: { type: "stock_transfer", id: transfer.id },
        moves,
        // between two branches the inventory moves from one to the other; inside one branch no account changes
        lines: (result) =>
          input.fromBranchId !== input.toBranchId && result.in.gt(0)
            ? bothSides({ role: "INVENTORY", branchId: input.toBranchId, debit: result.in, credit: ZERO }, { role: "INVENTORY", debit: ZERO, credit: result.out })
            : [],
      });
      for (const entry of consumed) {
        if (entry.lots.length > 0) {
          await addExpiryLots(tx, { organizationId: input.organizationId, branchId: input.toBranchId, warehouseId: toWarehouse.id, productId: entry.productId, variantId: entry.variantId, lots: entry.lots });
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
