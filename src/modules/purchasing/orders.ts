import { Prisma, type PurchaseStatus } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { moneyAccountFor } from "@/core/ledger/accounts";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, parseQuantity } from "@/core/money";
import type { PostLine } from "@/core/posting/journal";
import { postWithStock } from "@/core/posting/stock";
import { addSerials, cleanSerials, requireSerialPerUnit } from "@/core/stock";
import { businessDate as dhakaToday, dateOnly, isIsoDate } from "@/core/time/business-date";
import { occurredDate } from "@/lib/format/date";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { addExpiryLots, resolveWarehouse, StockRuleError } from "@/modules/inventory/stock";
import { reorderList } from "@/modules/inventory/alerts";
import { amountOf, costOf, failure, percentOf, type Actor } from "@/modules/purchasing/common";
import { costPurchase, type Costing } from "@/modules/purchasing/costing";
import { settleSupplier } from "@/modules/purchasing/supplier-payments";
import { outstandingPayable } from "@/modules/purchasing/suppliers";

// The life of a purchase (P05 task 3): written down (DRAFT), sent to the vendor (ORDERED: nothing is posted yet), received (RECEIVED: the
// stock comes in at its landed cost and the books are posted together, I3), or cancelled before it was received. A purchase takes its
// number when it leaves DRAFT, so drafts never leave a gap in the numbers (I12). Receiving twice, with one key or two, receives once.

type Tx = Prisma.TransactionClient;

export type PurchaseLineInput = {
  productId: string;
  variantId?: string;
  quantity: string;
  /** Up to four decimals. */
  unitCost: string;
  /** An amount, not a percentage. */
  discount?: string;
  /** A percentage. The VAT is part of what the goods cost (D2). */
  vatRate?: string;
  lot?: string;
  manufacturedOn?: string;
  expiresOn?: string;
  /** For a serial-tracked product: one IMEI or serial for each unit (needed when the purchase is received). */
  serials?: string[];
};

export type PurchaseInput = {
  supplierId: string;
  /** The date on the bill. */
  businessDate: string;
  warehouseId?: string;
  supplierInvoiceNo?: string;
  note?: string;
  headerDiscount?: string;
  /** Haulage (the carrier's hire) and other costs (labour): the purchase cost more than the vendor's bill (D3). */
  transportCost?: string;
  otherCost?: string;
  /** A carrier is a vendor too: on credit the haulage is owed to them. */
  transporterId?: string;
  vehicleNo?: string;
  /** How the haulage and other costs are paid: CASH or BANK now, or CREDIT (owed to the carrier). */
  transportPaidWith?: "CASH" | "BANK" | "CREDIT";
  lines: PurchaseLineInput[];
};

type Prepared = {
  costing: Costing;
  lines: Array<PurchaseLineInput & { quantityValue: Prisma.Decimal; unitCostValue: Prisma.Decimal; discountValue: Prisma.Decimal; vatRateValue: Prisma.Decimal; serialList: string[] }>;
  headerDiscount: Prisma.Decimal;
  transportCost: Prisma.Decimal;
  otherCost: Prisma.Decimal;
};

/** Reads and checks what was typed, and works out what the purchase costs. */
function prepare(input: Pick<PurchaseInput, "lines" | "headerDiscount" | "transportCost" | "otherCost">): Prepared {
  if (input.lines.length === 0) {
    throw new RuleError("Add a line to the purchase.");
  }
  if (input.lines.length > 200) {
    throw new RuleError("A purchase can have up to 200 lines.");
  }
  const lines = input.lines.map((line) => {
    const quantityValue = parseQuantity(line.quantity);
    if (!quantityValue) {
      throw new RuleError("Enter a quantity greater than zero with up to four decimals.");
    }
    for (const date of [line.manufacturedOn, line.expiresOn]) {
      if (date && !isIsoDate(date)) {
        throw new RuleError("Dates use YYYY-MM-DD.");
      }
    }
    return {
      ...line,
      quantityValue,
      unitCostValue: costOf(line.unitCost),
      discountValue: amountOf(line.discount, "a discount"),
      vatRateValue: percentOf(line.vatRate),
      serialList: cleanSerials(line.serials),
    };
  });
  const headerDiscount = amountOf(input.headerDiscount, "a discount");
  const transportCost = amountOf(input.transportCost, "the haulage cost");
  const otherCost = amountOf(input.otherCost, "the other costs");
  const costing = costPurchase({
    lines: lines.map((line) => ({ quantity: line.quantityValue, unitCost: line.unitCostValue, discount: line.discountValue, vatRate: line.vatRateValue })),
    headerDiscount,
    transportCost,
    otherCost,
  });
  return { costing, lines, headerDiscount, transportCost, otherCost };
}

/** What a purchase would cost, worked out the way receiving it will (for the form to show while it is typed). Nothing is saved. */
export function previewPurchase(input: Pick<PurchaseInput, "lines" | "headerDiscount" | "transportCost" | "otherCost">) {
  const { costing } = prepare(input);
  const two = (value: Prisma.Decimal) => decimalString(value, 2);
  return {
    subtotal: two(costing.subtotal),
    discountTotal: two(costing.discountTotal),
    vatTotal: two(costing.vatTotal),
    total: two(costing.total),
    haulage: two(costing.transportCost.plus(costing.otherCost)),
    landedTotal: two(costing.landedTotal),
    lines: costing.lines.map((line) => ({ lineTotal: two(line.taxable.plus(line.vat)), landedUnitCost: decimalString(line.landedUnitCost, 4) })),
  };
}

/** The vendor, the carrier (if any) and the products must be this organization's, and the products must be ones that hold stock. */
async function checkParties(tx: Tx, organizationId: string, input: Pick<PurchaseInput, "supplierId" | "transporterId" | "transportPaidWith" | "lines">, prepared: Prepared) {
  const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, organizationId }, select: { id: true, status: true, creditLimit: true } });
  if (!supplier) {
    throw new RuleError("That record was not found.", 404);
  }
  if (supplier.status !== "ACTIVE") {
    throw new RuleError("That supplier is not active.");
  }
  const haulage = prepared.transportCost.plus(prepared.otherCost);
  if (input.transporterId) {
    const carrier = await tx.supplier.findFirst({ where: { id: input.transporterId, organizationId, status: "ACTIVE" }, select: { id: true } });
    if (!carrier) {
      throw new RuleError("That carrier was not found.", 404);
    }
  }
  if (haulage.gt(0) && input.transportPaidWith === "CREDIT" && !input.transporterId) {
    throw new RuleError("Choose the carrier the haulage is owed to.");
  }
  if (input.transportPaidWith && !["CASH", "BANK", "CREDIT"].includes(input.transportPaidWith)) {
    throw new RuleError("The haulage is paid in cash, by bank, or on credit.");
  }
  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(input.lines.map((line) => line.productId))] }, organizationId, deletedAt: null },
    select: { id: true, trackStock: true, trackExpiry: true, trackSerial: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const line of input.lines) {
    const product = byId.get(line.productId);
    if (!product) {
      throw new RuleError("That record was not found.", 404);
    }
    if (!product.trackStock) {
      throw new RuleError("A service or other non-stock item cannot be purchased: record it as an expense.");
    }
  }
  return { supplier, products: byId };
}

function header(input: PurchaseInput, prepared: Prepared) {
  const { costing } = prepared;
  return {
    supplierId: input.supplierId,
    businessDate: occurredDate(input.businessDate),
    warehouseId: input.warehouseId ?? null,
    supplierInvoiceNo: input.supplierInvoiceNo?.trim() || null,
    note: input.note?.trim() || null,
    subtotal: costing.subtotal,
    discountTotal: costing.discountTotal,
    headerDiscount: costing.headerDiscount,
    vatTotal: costing.vatTotal,
    chargesTotal: costing.transportCost.plus(costing.otherCost),
    transportCost: costing.transportCost,
    otherCost: costing.otherCost,
    total: costing.total,
    transporterId: input.transporterId ?? null,
    vehicleNo: input.vehicleNo?.trim() || null,
    transportPaidWith: input.transportPaidWith ?? null,
  };
}

function itemRows(organizationId: string, prepared: Prepared) {
  return prepared.lines.map((line, index) => {
    const costed = prepared.costing.lines[index];
    return {
      organizationId,
      position: index,
      productId: line.productId,
      variantId: line.variantId ?? null,
      quantity: line.quantityValue,
      unitCost: line.unitCostValue,
      discount: line.discountValue,
      vatRate: line.vatRateValue,
      vatAmount: costed.vat,
      // what the vendor charges for the line (after its share of the header discount, with VAT): a return of the line is credited from it
      lineTotal: costed.taxable.plus(costed.vat),
      landedUnitCost: costed.landedUnitCost,
      lot: line.lot?.trim() || null,
      manufacturedOn: line.manufacturedOn ? occurredDate(line.manufacturedOn) : null,
      expiresOn: line.expiresOn ? occurredDate(line.expiresOn) : null,
      serials: line.serialList.length > 0 ? line.serialList : Prisma.JsonNull,
    };
  });
}

async function createDraft(tx: Tx, actor: Actor, input: PurchaseInput) {
  if (!isIsoDate(input.businessDate)) {
    throw new RuleError("Dates use YYYY-MM-DD.");
  }
  const prepared = prepare(input);
  await checkParties(tx, actor.organizationId, input, prepared);
  const row = await tx.purchase.create({
    data: {
      organizationId: actor.organizationId,
      branchId: actor.branchId,
      status: "DRAFT",
      createdById: actor.userId,
      ...header(input, prepared),
      warehouseId: input.warehouseId ?? actor.warehouseId ?? null,
      items: { create: itemRows(actor.organizationId, prepared) },
    },
    select: { id: true },
  });
  return row.id;
}

/** Locks a purchase of this branch and says what state it is in. */
async function lockPurchase(tx: Tx, actor: Actor, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: PurchaseStatus; number: string | null; supplierId: string }>>`
    SELECT id, status, number, supplierId FROM purchases WHERE id = ${id} AND organizationId = ${actor.organizationId} AND branchId = ${actor.branchId} FOR UPDATE
  `;
  if (!rows[0]) {
    throw new RuleError("That record was not found.", 404);
  }
  return rows[0];
}

type Outcome = { id: string; number: string | null; status: PurchaseStatus; replayed: boolean };

async function audited(actor: Actor, action: string, outcome: Outcome, after: Record<string, unknown>) {
  if (outcome.replayed) {
    return;
  }
  await writeAudit({
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    userId: actor.userId,
    action,
    module: "purchases",
    entityType: "purchase",
    entityId: outcome.id,
    after: { number: outcome.number, status: outcome.status, ...after } as Prisma.InputJsonObject,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}

async function replayOf(tx: Tx, actor: Actor, key: string, hash: string): Promise<Outcome | null> {
  const existing = await readIdempotency(tx, { organizationId: actor.organizationId, key, requestHash: hash });
  if (existing === "mismatch") {
    throw new StockRuleError("This idempotency key was already used for a different request.", 409);
  }
  if (!existing) {
    return null;
  }
  const row = await tx.purchase.findFirst({ where: { id: existing.entityId, organizationId: actor.organizationId }, select: { id: true, number: true, status: true } });
  return { id: existing.entityId, number: row?.number ?? null, status: row?.status ?? "DRAFT", replayed: true };
}

/** Gives a draft its number and sends it to the vendor. Nothing is posted. */
async function orderRow(tx: Tx, actor: Actor, id: string) {
  const current = await lockPurchase(tx, actor, id);
  if (current.status !== "DRAFT") {
    throw new RuleError(current.status === "ORDERED" ? "That purchase was already ordered." : "Only a draft can be ordered.", 409);
  }
  const row = await tx.purchase.findUniqueOrThrow({ where: { id }, select: { businessDate: true } });
  const number = await allocateNumber(tx, { organizationId: actor.organizationId, documentType: "PUR", businessDate: dateOnly(row.businessDate) });
  await tx.purchase.update({ where: { id }, data: { status: "ORDERED", number } });
  return number;
}

export type PurchaseMode = "draft" | "ordered" | "received";

/**
 * Makes a new purchase and takes it as far as asked, in one transaction under one key: written down (draft), or sent to the vendor
 * (ordered), or received at once (the goods are in the warehouse and the books are posted).
 */
export async function placePurchase(actor: Actor, input: PurchaseInput & ReceiveInput, mode: PurchaseMode) {
  const hash = hashPayload({ kind: mode, input });
  try {
    const outcome = await idempotentTransaction(async (tx) => {
      const replay = await replayOf(tx, actor, actor.idempotencyKey, hash);
      if (replay) {
        return { ...replay, total: null as string | null };
      }
      const id = await createDraft(tx, actor, input);
      let number: string | null = null;
      let total: string | null = null;
      if (mode === "ordered") {
        number = await orderRow(tx, actor, id);
      } else if (mode === "received") {
        const done = await receiveRow(tx, actor, id, { receivedOn: input.receivedOn ?? input.businessDate, paymentAmount: input.paymentAmount, paymentMethod: input.paymentMethod, paymentAccountId: input.paymentAccountId });
        number = done.number;
        total = decimalString(done.total, 2);
      }
      await saveIdempotency(tx, { organizationId: actor.organizationId, userId: actor.userId, key: actor.idempotencyKey, requestHash: hash, entityType: "purchase", entityId: id });
      const status: PurchaseStatus = mode === "draft" ? "DRAFT" : mode === "ordered" ? "ORDERED" : "RECEIVED";
      return { id, number, status, replayed: false, total };
    });
    await audited(actor, mode === "draft" ? "create" : mode === "ordered" ? "order" : "purchase", outcome, { total: outcome.total });
    return { ok: true as const, ...outcome };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/** Writes a purchase down. Nothing is posted and it has no number yet. */
export const saveDraftPurchase = (actor: Actor, input: PurchaseInput) => placePurchase(actor, input, "draft");

/** A purchase made and received in one go (goods bought over the counter); who is acting and what is bought come in one object. */
export function postPurchase(input: Actor & PurchaseInput & ReceiveInput) {
  const { organizationId, branchId, userId, idempotencyKey, ip, userAgent, ...purchase } = input;
  return placePurchase({ organizationId, branchId, userId, warehouseId: input.warehouseId, idempotencyKey, ip, userAgent }, purchase, "received");
}

/** Changes a purchase that is still a draft or only ordered (nothing was posted for it): all of its figures and lines are replaced. */
export async function updatePurchase(actor: Actor, id: string, input: PurchaseInput) {
  const hash = hashPayload({ kind: "update", id, input });
  try {
    const outcome = await idempotentTransaction(async (tx) => {
      const replay = await replayOf(tx, actor, actor.idempotencyKey, hash);
      if (replay) {
        return replay;
      }
      const current = await lockPurchase(tx, actor, id);
      if (current.status !== "DRAFT" && current.status !== "ORDERED") {
        throw new RuleError(current.status === "RECEIVED" ? "A received purchase cannot be changed: return the goods instead." : "A cancelled purchase cannot be changed.", 409);
      }
      if (!isIsoDate(input.businessDate)) {
        throw new RuleError("Dates use YYYY-MM-DD.");
      }
      const prepared = prepare(input);
      await checkParties(tx, actor.organizationId, input, prepared);
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id, organizationId: actor.organizationId } });
      await tx.purchase.update({ where: { id }, data: { ...header(input, prepared), warehouseId: input.warehouseId ?? actor.warehouseId ?? null, items: { create: itemRows(actor.organizationId, prepared) } } });
      await saveIdempotency(tx, { organizationId: actor.organizationId, userId: actor.userId, key: actor.idempotencyKey, requestHash: hash, entityType: "purchase", entityId: id });
      return { id, number: current.number, status: current.status, replayed: false };
    });
    await audited(actor, "update", outcome, {});
    return { ok: true as const, ...outcome };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/** Sends the purchase to the vendor: it gets its number and can be printed as an order. Nothing is posted. */
export async function orderPurchase(actor: Actor, id: string) {
  const hash = hashPayload({ kind: "order", id });
  try {
    const outcome = await idempotentTransaction(async (tx) => {
      const replay = await replayOf(tx, actor, actor.idempotencyKey, hash);
      if (replay) {
        return replay;
      }
      const number = await orderRow(tx, actor, id);
      await saveIdempotency(tx, { organizationId: actor.organizationId, userId: actor.userId, key: actor.idempotencyKey, requestHash: hash, entityType: "purchase", entityId: id });
      return { id, number, status: "ORDERED" as PurchaseStatus, replayed: false };
    });
    await audited(actor, "order", outcome, {});
    return { ok: true as const, ...outcome };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/** A purchase that was not received can be called off; a received one is undone by returning the goods. */
export async function cancelPurchase(actor: Actor, id: string) {
  const hash = hashPayload({ kind: "cancel", id });
  try {
    const outcome = await idempotentTransaction(async (tx) => {
      const replay = await replayOf(tx, actor, actor.idempotencyKey, hash);
      if (replay) {
        return replay;
      }
      const current = await lockPurchase(tx, actor, id);
      if (current.status === "RECEIVED") {
        throw new RuleError("A received purchase cannot be cancelled: return the goods instead.", 409);
      }
      if (current.status === "CANCELLED") {
        throw new RuleError("That purchase was already cancelled.", 409);
      }
      await tx.purchase.update({ where: { id }, data: { status: "CANCELLED" } });
      await saveIdempotency(tx, { organizationId: actor.organizationId, userId: actor.userId, key: actor.idempotencyKey, requestHash: hash, entityType: "purchase", entityId: id });
      return { id, number: current.number, status: "CANCELLED" as PurchaseStatus, replayed: false };
    });
    await audited(actor, "cancel", outcome, {});
    return { ok: true as const, ...outcome };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export type ReceiveInput = {
  /** The day the goods came; the stock and the journal are dated by it. Today when left out. */
  receivedOn?: string;
  /** Paid to the vendor at the same time (a payment of its own). */
  paymentAmount?: string;
  paymentMethod?: "CASH" | "BANK" | "MOBILE";
  /** The cash, bank or mobile account the payment leaves from (the default cash drawer or bank when left out). */
  paymentAccountId?: string;
};

/**
 * Receives the purchase: each line comes into stock at its landed cost, and one journal posts the goods (Dr Inventory), the vendor's bill
 * (Cr Payable) and the haulage (Cr cash or bank, or Cr the carrier's payable). Whatever the cents of rounding leave over goes to Purchase
 * Price Variance, so the inventory account moves by exactly the stock (I3).
 */
async function receiveRow(tx: Tx, actor: Actor, id: string, input: ReceiveInput) {
  const current = await lockPurchase(tx, actor, id);
  if (current.status === "RECEIVED") {
    throw new RuleError("That purchase was already received.", 409);
  }
  if (current.status === "CANCELLED") {
    throw new RuleError("A cancelled purchase cannot be received.", 409);
  }
  const row = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: [{ position: "asc" }, { id: "asc" }] } } });
  const receivedOn = input.receivedOn ?? dhakaToday();
  if (!isIsoDate(receivedOn)) {
    throw new RuleError("Dates use YYYY-MM-DD.");
  }
  const lines: PurchaseLineInput[] = row.items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId ?? undefined,
    quantity: item.quantity.toFixed(4),
    unitCost: item.unitCost.toFixed(4),
    discount: item.discount.toFixed(2),
    vatRate: item.vatRate.toFixed(2),
    lot: item.lot ?? undefined,
    manufacturedOn: item.manufacturedOn ? dateOnly(item.manufacturedOn) : undefined,
    expiresOn: item.expiresOn ? dateOnly(item.expiresOn) : undefined,
    serials: Array.isArray(item.serials) ? (item.serials as string[]) : undefined,
  }));
  const prepared = prepare({ lines, headerDiscount: row.headerDiscount.toFixed(2), transportCost: row.transportCost.toFixed(2), otherCost: row.otherCost.toFixed(2) });
  const paidWith = (row.transportPaidWith ?? "CASH") as "CASH" | "BANK" | "CREDIT";
  const { supplier, products } = await checkParties(tx, actor.organizationId, { supplierId: row.supplierId, transporterId: row.transporterId ?? undefined, transportPaidWith: paidWith, lines }, prepared);
  const warehouse = await resolveWarehouse(actor.organizationId, actor.branchId, row.warehouseId ?? actor.warehouseId);
  if (!warehouse) {
    throw new RuleError("Choose an active warehouse on the current branch.");
  }
  // What each kind of product needs when it comes in.
  for (const line of prepared.lines) {
    const product = products.get(line.productId);
    if (product?.trackExpiry && (!line.lot || !line.expiresOn)) {
      throw new RuleError("Expiry-tracked products need a lot and an expiry date.");
    }
    if (product?.trackSerial) {
      requireSerialPerUnit(line.quantityValue, line.serialList);
    } else if (line.serialList.length > 0) {
      throw new RuleError("This product does not track serial numbers.");
    }
  }
  const payment = amountOf(input.paymentAmount, "a payment amount");
  if (payment.gt(prepared.costing.total)) {
    throw new RuleError("The payment is greater than the purchase total.");
  }
  if (payment.gt(0) && !input.paymentMethod) {
    throw new RuleError("Choose cash or bank for the payment.");
  }
  const number = current.number ?? (await allocateNumber(tx, { organizationId: actor.organizationId, documentType: "PUR", businessDate: receivedOn }));

  const haulage = prepared.transportCost.plus(prepared.otherCost);
  const haulageAccount = haulage.gt(0) && paidWith !== "CREDIT" ? await moneyAccountFor(tx, actor.organizationId, { method: paidWith }) : null;
  const zero = new Prisma.Decimal(0);
  const { journalId, moved } = await postWithStock(tx, {
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    businessDate: occurredDate(receivedOn),
    description: `Purchase ${number}`,
    createdById: actor.userId,
    doc: { type: "PURCHASE", id },
    reference: { type: "purchase", id },
    moves: prepared.lines.map((line, index) => ({
      productId: line.productId,
      variantId: line.variantId,
      warehouseId: warehouse.id,
      quantity: line.quantityValue,
      direction: "IN" as const,
      movementType: "PURCHASE" as const,
      unitCost: prepared.costing.lines[index].landedUnitCost,
    })),
    lines: (result) => {
      const total = prepared.costing.total;
      const variance = total.plus(haulage).minus(result.in);
      const journal: PostLine[] = [];
      if (result.in.gt(0)) {
        journal.push({ role: "INVENTORY", debit: result.in, credit: zero });
      }
      if (total.gt(0)) {
        journal.push({ role: "AP", debit: zero, credit: total, party: { type: "VENDOR" as const, id: row.supplierId } });
      }
      if (haulage.gt(0)) {
        journal.push(
          haulageAccount
            ? { accountId: haulageAccount, debit: zero, credit: haulage }
            : { role: "AP", debit: zero, credit: haulage, party: { type: "VENDOR" as const, id: row.transporterId as string } },
        );
      }
      // the cents the landed unit costs (four decimals) could not carry
      if (variance.gt(0)) {
        journal.push({ role: "PPV", debit: variance, credit: zero });
      } else if (variance.lt(0)) {
        journal.push({ role: "PPV", debit: zero, credit: variance.neg() });
      }
      return journal.length >= 2 ? journal : [];
    },
  });
  for (const [index, line] of prepared.lines.entries()) {
    if (line.serialList.length > 0) {
      await addSerials(tx, { organizationId: actor.organizationId, productId: line.productId, variantId: line.variantId, warehouseId: warehouse.id, serials: line.serialList, inMovementId: moved.results[index].ledgerId });
    }
    if (products.get(line.productId)?.trackExpiry && line.lot && line.expiresOn) {
      await addExpiryLots(tx, {
        organizationId: actor.organizationId,
        branchId: actor.branchId,
        warehouseId: warehouse.id,
        productId: line.productId,
        variantId: line.variantId,
        lots: [{ lot: line.lot, manufacturedOn: line.manufacturedOn ? occurredDate(line.manufacturedOn) : null, expiresOn: occurredDate(line.expiresOn), quantity: line.quantityValue }],
      });
    }
    await tx.purchaseItem.update({ where: { id: row.items[index].id }, data: { lineTotal: prepared.costing.lines[index].taxable.plus(prepared.costing.lines[index].vat), vatAmount: prepared.costing.lines[index].vat, landedUnitCost: prepared.costing.lines[index].landedUnitCost } });
  }
  await tx.purchase.update({
    where: { id },
    data: { status: "RECEIVED", number, receivedOn: occurredDate(receivedOn), warehouseId: warehouse.id, journalId, total: prepared.costing.total, subtotal: prepared.costing.subtotal, discountTotal: prepared.costing.discountTotal, vatTotal: prepared.costing.vatTotal },
  });
  if (payment.gt(0) && input.paymentMethod) {
    await settleSupplier(tx, { ...actor, supplierId: row.supplierId, businessDate: receivedOn, amount: payment, method: input.paymentMethod, accountId: input.paymentAccountId, purchaseId: id });
  }
  if (supplier.creditLimit && (await outstandingPayable(actor.organizationId, supplier.id, tx)).gt(supplier.creditLimit)) {
    throw new StockRuleError("The purchase exceeds the supplier credit limit.");
  }
  return { id, number, total: prepared.costing.total };
}

export async function receivePurchase(actor: Actor, id: string, input: ReceiveInput = {}) {
  const hash = hashPayload({ kind: "receive", id, input });
  try {
    const outcome = await idempotentTransaction(async (tx) => {
      const replay = await replayOf(tx, actor, actor.idempotencyKey, hash);
      if (replay) {
        return { ...replay, total: null as string | null };
      }
      const done = await receiveRow(tx, actor, id, input);
      await saveIdempotency(tx, { organizationId: actor.organizationId, userId: actor.userId, key: actor.idempotencyKey, requestHash: hash, entityType: "purchase", entityId: id });
      return { id, number: done.number, status: "RECEIVED" as PurchaseStatus, replayed: false, total: decimalString(done.total, 2) as string | null };
    });
    await audited(actor, "receive", outcome, { total: outcome.total });
    return { ok: true as const, ...outcome };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/**
 * One click from the reorder list (P03) to purchase drafts: the products that need buying (all of them, or the ones named) are grouped by the
 * vendor they were last bought from, each group becomes a DRAFT purchase at the last cost with the suggested quantity. Products never bought,
 * or whose last vendor is no longer active, are left out and counted (somebody has to choose a vendor for them). Nothing is posted.
 */
export async function draftsFromReorder(actor: Actor, input: { productIds?: string[] } = {}) {
  const hash = hashPayload({ kind: "reorder", productIds: input.productIds ?? null });
  try {
    const outcome = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, { organizationId: actor.organizationId, key: actor.idempotencyKey, requestHash: hash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { ids: [existing.entityId], skipped: 0, replayed: true };
      }
      const wanted = input.productIds ? new Set(input.productIds) : null;
      const rows = (await reorderList(actor.organizationId, actor.branchId)).filter((row) => Number(row.suggested) > 0 && (!wanted || wanted.has(row.productId)));
      const active = new Set((await tx.supplier.findMany({ where: { organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true } })).map((row) => row.id));
      const groups = new Map<string, typeof rows>();
      let skipped = 0;
      for (const row of rows) {
        if (!row.lastVendorId || !active.has(row.lastVendorId)) {
          skipped += 1;
          continue;
        }
        groups.set(row.lastVendorId, [...(groups.get(row.lastVendorId) ?? []), row]);
      }
      if (groups.size === 0) {
        throw new RuleError(skipped > 0 ? "None of these products has an active vendor it was bought from: make the purchase by hand." : "Nothing needs to be reordered.");
      }
      const today = dhakaToday();
      const ids: string[] = [];
      for (const [supplierId, group] of groups) {
        ids.push(
          await createDraft(tx, actor, {
            supplierId,
            businessDate: today,
            warehouseId: actor.warehouseId,
            note: "From the reorder list",
            lines: group.map((row) => ({ productId: row.productId, quantity: row.suggested, unitCost: row.lastCost || "0" })),
          }),
        );
      }
      await saveIdempotency(tx, { organizationId: actor.organizationId, userId: actor.userId, key: actor.idempotencyKey, requestHash: hash, entityType: "purchase", entityId: ids[0] });
      return { ids, skipped, replayed: false };
    });
    if (!outcome.replayed) {
      await audited(actor, "reorder", { id: outcome.ids[0], number: null, status: "DRAFT", replayed: false }, { drafts: outcome.ids.length, skipped: outcome.skipped });
    }
    return { ok: true as const, ...outcome };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}
