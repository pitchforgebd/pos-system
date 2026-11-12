import { Prisma, type DeliveryMethod, type OrderChannel, type OrderStatus } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { documentSorts, listQuery, pageInfo, type ListQuery, type Paged } from "@/core/list";
import { decimalString, parseMoney, zero } from "@/core/money";
import { dateOnly, isIsoDate } from "@/core/time/business-date";
import { occurredDate } from "@/lib/format/date";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { resolveWarehouse, StockRuleError } from "@/modules/inventory/stock";
import { failure, type Actor } from "@/modules/purchasing/common";
import type { ShipmentInput } from "@/modules/shipping/shipments";
import { postInvoice, priceLines, type InvoiceLine, type TenderInput } from "@/modules/sales/invoice";

// A sales order (P06 task 3, feature 14): written down (DRAFT, or a quotation), confirmed (the stock is reserved, so two orders cannot
// both take the last unit), packed, dispatched (the invoice posts and the stock goes out, the reservation is consumed, D4), delivered; or
// cancelled before it was dispatched (the reservation is released). After a dispatch only a return undoes it. Every change is an event.

type Tx = Prisma.TransactionClient;

export type OrderInput = {
  customerId: string;
  businessDate: string;
  channel?: OrderChannel;
  deliveryMethod?: DeliveryMethod;
  shippingAddress?: string;
  districtId?: string;
  upazilaId?: string;
  externalRef?: string;
  expectedDate?: string;
  note?: string;
  warehouseId?: string;
  level?: string;
  headerDiscount?: string;
  /** Delivery and other charges. */
  chargesTotal?: string;
  lines: InvoiceLine[];
  /** A quotation: a draft order with a valid-until date and its own QUO number. */
  isQuotation?: boolean;
  validUntil?: string;
};

export type OrderFlags = { allowDiscount?: boolean; allowPriceOverride?: boolean; allowPriceLevel?: boolean };

const ZERO = zero();

async function pricing(tx: Tx, actor: Actor, input: OrderInput, flags: OrderFlags) {
  if (!isIsoDate(input.businessDate) || (input.expectedDate && !isIsoDate(input.expectedDate)) || (input.validUntil && !isIsoDate(input.validUntil))) {
    throw new RuleError("Dates use YYYY-MM-DD.");
  }
  if (input.lines.length === 0) {
    throw new RuleError("Add a line to the order.");
  }
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, organizationId: actor.organizationId }, select: { id: true, status: true, isSystem: true, customerTypeId: true } });
  if (!customer) {
    throw new RuleError("That record was not found.", 404);
  }
  if (customer.isSystem) {
    throw new RuleError("An order needs a named customer.");
  }
  if (customer.status !== "ACTIVE") {
    throw new RuleError("That customer is not active.");
  }
  if (input.level && flags.allowPriceLevel === false) {
    throw new RuleError("You may not change the price level.");
  }
  const shop = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { maxDiscountPercent: true } });
  const header = parseMoney(input.headerDiscount ?? "0.00");
  const charges = parseMoney(input.chargesTotal ?? "0.00");
  if (!header || header.isNeg() || !charges || charges.isNeg()) {
    throw new RuleError("Enter a discount or a charge with up to two decimals.");
  }
  const priced = await priceLines(tx, actor.organizationId, customer, shop, header, charges, { level: input.level, lines: input.lines, allowDiscount: flags.allowDiscount, allowPriceOverride: flags.allowPriceOverride });
  return { priced, header, charges };
}

function orderRow(actor: Actor, input: OrderInput, p: Awaited<ReturnType<typeof pricing>>) {
  return {
    customerId: input.customerId,
    businessDate: occurredDate(input.businessDate),
    channel: input.channel ?? "PHONE",
    deliveryMethod: input.deliveryMethod ?? "PICKUP",
    shippingAddress: input.shippingAddress?.trim() || null,
    districtId: input.districtId ?? null,
    upazilaId: input.upazilaId ?? null,
    externalRef: input.externalRef?.trim() || null,
    expectedDate: input.expectedDate ? occurredDate(input.expectedDate) : null,
    note: input.note?.trim() || null,
    warehouseId: input.warehouseId ?? actor.warehouseId ?? null,
    isQuotation: Boolean(input.isQuotation),
    validUntil: input.validUntil ? occurredDate(input.validUntil) : null,
    subtotal: p.priced.grossTotal,
    discountTotal: p.priced.discountTotal,
    headerDiscount: p.header,
    vatTotal: p.priced.vatTotal,
    chargesTotal: p.charges,
    total: p.priced.total,
  };
}

function itemRows(organizationId: string, p: Awaited<ReturnType<typeof pricing>>) {
  return p.priced.lines.map((line, position) => ({
    organizationId,
    position,
    productId: line.resolved.productId,
    variantId: line.resolved.variantId ?? null,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    priceLevelId: line.priceLevelId,
    discountAmount: line.discount,
    vatAmount: line.vat,
    lineTotal: line.payable,
  }));
}

async function addEvent(tx: Tx, actor: Actor, orderId: string, from: OrderStatus | null, to: OrderStatus, note?: string) {
  await tx.orderEvent.create({ data: { organizationId: actor.organizationId, orderId, fromStatus: from, toStatus: to, userId: actor.userId, note: note ?? null } });
}

async function lockOrder(tx: Tx, actor: Actor, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: OrderStatus; number: string | null; customerId: string; isQuotation: number | boolean; validUntil: Date | null; warehouseId: string | null }>>`
    SELECT id, status, number, customerId, isQuotation, validUntil, warehouseId FROM sales_orders
    WHERE id = ${id} AND organizationId = ${actor.organizationId} AND branchId = ${actor.branchId} FOR UPDATE
  `;
  if (!rows[0]) {
    throw new RuleError("That record was not found.", 404);
  }
  return rows[0];
}

type Outcome = { id: string; number: string | null; status: OrderStatus; replayed: boolean; invoiceId?: string | null };

/** The shared frame of every order operation: one key, one transaction, replay answers the same, one audit row. */
async function operate(actor: Actor, kind: string, extra: unknown, work: (tx: Tx) => Promise<Omit<Outcome, "replayed">>) {
  const hash = hashPayload({ kind, extra });
  try {
    const outcome = await idempotentTransaction(async (tx): Promise<Outcome> => {
      const existing = await readIdempotency(tx, { organizationId: actor.organizationId, key: actor.idempotencyKey, requestHash: hash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        const row = await tx.salesOrder.findFirst({ where: { id: existing.entityId, organizationId: actor.organizationId }, select: { id: true, number: true, status: true } });
        return { id: existing.entityId, number: row?.number ?? null, status: row?.status ?? "DRAFT", replayed: true };
      }
      const done = await work(tx);
      await saveIdempotency(tx, { organizationId: actor.organizationId, userId: actor.userId, key: actor.idempotencyKey, requestHash: hash, entityType: "sales_order", entityId: done.id });
      return { ...done, replayed: false };
    });
    if (!outcome.replayed) {
      await writeAudit({ organizationId: actor.organizationId, branchId: actor.branchId, userId: actor.userId, action: kind, module: "orders", entityType: "sales_order", entityId: outcome.id, after: { number: outcome.number, status: outcome.status }, ip: actor.ip, userAgent: actor.userAgent });
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

/** Writes an order (or a quotation) down. Nothing is reserved or posted. */
export function createOrder(actor: Actor, input: OrderInput, flags: OrderFlags = {}) {
  return operate(actor, input.isQuotation ? "quotation" : "create", input, async (tx) => {
    const p = await pricing(tx, actor, input, flags);
    const quotationNumber = input.isQuotation ? await allocateNumber(tx, { organizationId: actor.organizationId, documentType: "QUO", businessDate: input.businessDate }) : null;
    const row = await tx.salesOrder.create({
      data: { organizationId: actor.organizationId, branchId: actor.branchId, status: "DRAFT", createdById: actor.userId, quotationNumber, ...orderRow(actor, input, p), items: { create: itemRows(actor.organizationId, p) } },
      select: { id: true },
    });
    await addEvent(tx, actor, row.id, null, "DRAFT", input.isQuotation ? "Quotation" : undefined);
    return { id: row.id, number: null, status: "DRAFT" };
  });
}

/** Changes an order that is still a draft: its lines and figures are replaced and priced again. */
export function updateOrder(actor: Actor, id: string, input: OrderInput, flags: OrderFlags = {}) {
  return operate(actor, "update", { id, input }, async (tx) => {
    const current = await lockOrder(tx, actor, id);
    if (current.status !== "DRAFT") {
      throw new RuleError("Only a draft order can be changed.", 409);
    }
    const p = await pricing(tx, actor, input, flags);
    await tx.salesOrderItem.deleteMany({ where: { orderId: id, organizationId: actor.organizationId } });
    await tx.salesOrder.update({ where: { id }, data: { ...orderRow(actor, input, p), items: { create: itemRows(actor.organizationId, p) } } });
    await addEvent(tx, actor, id, "DRAFT", "DRAFT", "Changed");
    return { id, number: current.number, status: "DRAFT" };
  });
}

/** Holds stock for the order, so no other sale can take it (available = on hand - reserved). The second order for the last unit fails here. */
async function reserve(tx: Tx, actor: Actor, orderId: string, warehouseId: string) {
  const items = await tx.salesOrderItem.findMany({ where: { orderId, organizationId: actor.organizationId }, orderBy: [{ productId: "asc" }, { id: "asc" }], include: { product: { select: { name: true, trackStock: true } } } });
  for (const item of items) {
    if (!item.product.trackStock) {
      continue; // a service holds no stock
    }
    const variantScope = item.variantId ?? "";
    const rows = await tx.$queryRaw<Array<{ id: string; quantity: Prisma.Decimal; reservedQty: Prisma.Decimal }>>`
      SELECT id, quantity, reservedQty FROM stock_balances
      WHERE organizationId = ${actor.organizationId} AND productId = ${item.productId} AND variantScope = ${variantScope} AND branchId = ${actor.branchId} AND warehouseId = ${warehouseId}
      FOR UPDATE
    `;
    const available = rows[0] ? new Prisma.Decimal(rows[0].quantity).minus(rows[0].reservedQty) : ZERO;
    if (!rows[0] || available.lt(item.quantity)) {
      throw new RuleError(`Not enough stock of ${item.product.name}: ${decimalString(Prisma.Decimal.max(available, 0), 4)} available, ${decimalString(item.quantity, 4)} ordered.`);
    }
    await tx.$executeRaw`UPDATE stock_balances SET reservedQty = reservedQty + ${item.quantity} WHERE id = ${rows[0].id}`;
    await tx.stockReservation.create({ data: { organizationId: actor.organizationId, orderId, orderItemId: item.id, productId: item.productId, variantId: item.variantId, warehouseId, quantity: item.quantity, status: "ACTIVE" } });
  }
}

/** Gives back what the order was holding (a cancelled order). */
async function release(tx: Tx, actor: Actor, orderId: string) {
  const held = await tx.stockReservation.findMany({ where: { orderId, organizationId: actor.organizationId, status: "ACTIVE" }, orderBy: [{ productId: "asc" }, { id: "asc" }] });
  for (const row of held) {
    await tx.$executeRaw`
      UPDATE stock_balances SET reservedQty = GREATEST(reservedQty - ${row.quantity}, 0)
      WHERE organizationId = ${actor.organizationId} AND productId = ${row.productId} AND variantScope = ${row.variantId ?? ""} AND branchId = ${actor.branchId} AND warehouseId = ${row.warehouseId}
    `;
    await tx.stockReservation.update({ where: { id: row.id }, data: { status: "RELEASED" } });
  }
}

/** DRAFT -> CONFIRMED: the order takes its number and the stock is reserved. */
export function confirmOrder(actor: Actor, id: string) {
  return operate(actor, "confirm", { id }, async (tx) => {
    const current = await lockOrder(tx, actor, id);
    if (current.status !== "DRAFT") {
      throw new RuleError("Only a draft order can be confirmed.", 409);
    }
    if (current.validUntil && current.validUntil.getTime() < occurredDate(dateOnly(new Date())).getTime()) {
      throw new RuleError("This quotation has expired.");
    }
    const warehouse = await resolveWarehouse(actor.organizationId, actor.branchId, current.warehouseId ?? actor.warehouseId);
    if (!warehouse) {
      throw new RuleError("Choose an active warehouse on the current branch.");
    }
    const row = await tx.salesOrder.findUniqueOrThrow({ where: { id }, select: { businessDate: true } });
    await reserve(tx, actor, id, warehouse.id);
    const number = await allocateNumber(tx, { organizationId: actor.organizationId, documentType: "ORD", businessDate: dateOnly(row.businessDate) });
    await tx.salesOrder.update({ where: { id }, data: { status: "CONFIRMED", number, warehouseId: warehouse.id } });
    await addEvent(tx, actor, id, "DRAFT", "CONFIRMED", current.isQuotation ? "Quotation confirmed" : undefined);
    return { id, number, status: "CONFIRMED" };
  });
}

export function packOrder(actor: Actor, id: string) {
  return operate(actor, "pack", { id }, async (tx) => {
    const current = await lockOrder(tx, actor, id);
    if (current.status !== "CONFIRMED") {
      throw new RuleError("Only a confirmed order can be packed.", 409);
    }
    await tx.salesOrder.update({ where: { id }, data: { status: "PACKED" } });
    await addEvent(tx, actor, id, "CONFIRMED", "PACKED");
    return { id, number: current.number, status: "PACKED" };
  });
}

/** Called off before it was dispatched: whatever it held is released. After the dispatch only a return undoes it. */
export function cancelOrder(actor: Actor, id: string, note?: string) {
  return operate(actor, "cancel", { id, note }, async (tx) => {
    const current = await lockOrder(tx, actor, id);
    if (current.status === "CANCELLED") {
      throw new RuleError("That order was already cancelled.", 409);
    }
    if (current.status === "DISPATCHED" || current.status === "DELIVERED" || current.status === "RETURNED") {
      throw new RuleError("A dispatched order cannot be cancelled: return the goods instead.");
    }
    await release(tx, actor, id);
    await tx.salesOrder.update({ where: { id }, data: { status: "CANCELLED" } });
    await addEvent(tx, actor, id, current.status, "CANCELLED", note);
    return { id, number: current.number, status: "CANCELLED" };
  });
}

export type DispatchInput = { dispatchedOn: string; tenders?: TenderInput[]; shiftId?: string; /** How it goes: the courier and the charges, or the vehicle (the order's delivery method says which). */ shipment?: ShipmentInput };

/**
 * CONFIRMED or PACKED -> DISPATCHED (D4): the invoice posts at the order's prices, the stock goes out, the reservation is consumed (the
 * stock movement gives it up itself). What the customer pays now (their advance, say) is received with it.
 */
export async function dispatchOrder(actor: Actor, id: string, input: DispatchInput) {
  const order = await prisma.salesOrder.findFirst({ where: { id, organizationId: actor.organizationId, branchId: actor.branchId }, include: { items: { orderBy: [{ position: "asc" }, { id: "asc" }] } } });
  if (!order) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  if (order.status !== "CONFIRMED" && order.status !== "PACKED") {
    // a retry with the key of the dispatch that already happened gets that dispatch's answer back
    const retried = await prisma.idempotencyKey.findFirst({ where: { organizationId: actor.organizationId, key: actor.idempotencyKey }, select: { id: true } });
    if (!retried) {
      return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: "Only a confirmed or packed order can be dispatched." };
    }
  }
  const invoice = await postInvoice({
    ...actor,
    businessDate: input.dispatchedOn,
    customerId: order.customerId,
    orderId: order.id,
    shiftId: input.shiftId,
    districtId: order.districtId ?? undefined,
    warehouseId: order.warehouseId ?? undefined,
    headerDiscount: order.headerDiscount.toFixed(2),
    chargesTotal: order.chargesTotal.toFixed(2),
    fixedPrices: true,
    tenders: input.tenders,
    lines: order.items.map((item) => ({ productId: item.productId, variantId: item.variantId ?? undefined, quantity: item.quantity.toFixed(4), unitPrice: item.unitPrice.toFixed(2), discountAmount: item.discountAmount.toFixed(2) })),
    inTransaction: async (tx, sale) => {
      // another dispatch (or a cancel) at the same moment: only one wins
      const locked = await lockOrder(tx, actor, id);
      if (locked.status !== "CONFIRMED" && locked.status !== "PACKED") {
        throw new RuleError("Only a confirmed or packed order can be dispatched.", 409);
      }
      await tx.stockReservation.updateMany({ where: { orderId: id, organizationId: actor.organizationId, status: "ACTIVE" }, data: { status: "CONSUMED" } });
      await tx.salesOrder.update({ where: { id }, data: { status: "DISPATCHED" } });
      await addEvent(tx, actor, id, locked.status, "DISPATCHED", `Invoice ${sale.id}`);
      // by the shop's vehicle or by courier: the shipment, its handover and its charges, in this same transaction
      const { createShipmentInTx } = await import("@/modules/shipping/shipments");
      await createShipmentInTx(tx, actor, { saleId: sale.id, customerId: sale.customerId, businessDate: input.dispatchedOn, order: { id, deliveryMethod: order.deliveryMethod, shippingAddress: order.shippingAddress }, shipment: input.shipment });
    },
  });
  if (!invoice.ok) {
    return invoice;
  }
  return { ok: true as const, id, number: order.number, status: "DISPATCHED" as OrderStatus, replayed: invoice.replayed, invoiceId: invoice.id, invoiceNumber: invoice.number };
}

export function deliverOrder(actor: Actor, id: string) {
  return operate(actor, "deliver", { id }, async (tx) => {
    const current = await lockOrder(tx, actor, id);
    if (current.status !== "DISPATCHED") {
      throw new RuleError("Only a dispatched order can be delivered.", 409);
    }
    // a parcel with a courier is delivered on its shipment (the order follows); the shop's own vehicle is delivered with the order
    const shipment = await tx.shipment.findFirst({ where: { orderId: id, organizationId: actor.organizationId }, select: { id: true, method: true, status: true } });
    if (shipment?.method === "COURIER" && shipment.status !== "DELIVERED") {
      throw new RuleError("This order goes by courier: mark its parcel delivered on the shipment.", 409);
    }
    if (shipment && shipment.status !== "DELIVERED") {
      await tx.shipment.update({ where: { id: shipment.id }, data: { status: "DELIVERED", deliveredOn: occurredDate(dateOnly(new Date())) } });
      await tx.shipmentEvent.create({ data: { organizationId: actor.organizationId, shipmentId: shipment.id, status: "DELIVERED", userId: actor.userId, note: "With the order" } });
    }
    await tx.salesOrder.update({ where: { id }, data: { status: "DELIVERED" } });
    await addEvent(tx, actor, id, "DISPATCHED", "DELIVERED");
    return { id, number: current.number, status: "DELIVERED" };
  });
}

/** After a sale return: an order whose goods all came back is RETURNED. Runs in the return's transaction. */
export async function markOrderReturned(tx: Tx, organizationId: string, userId: string, saleId: string) {
  const sale = await tx.sale.findFirst({ where: { id: saleId, organizationId }, select: { orderId: true, items: { select: { quantity: true, returnItems: { where: { saleReturn: { status: "POSTED" } }, select: { quantity: true } } } } } });
  if (!sale?.orderId) {
    return;
  }
  const allBack = sale.items.every((item) => item.returnItems.reduce((sum, row) => sum.plus(row.quantity), ZERO).gte(item.quantity));
  if (!allBack) {
    return;
  }
  const order = await tx.salesOrder.findFirst({ where: { id: sale.orderId, organizationId }, select: { id: true, status: true } });
  if (order && (order.status === "DISPATCHED" || order.status === "DELIVERED")) {
    await tx.salesOrder.update({ where: { id: order.id }, data: { status: "RETURNED" } });
    await tx.orderEvent.create({ data: { organizationId, orderId: order.id, fromStatus: order.status, toStatus: "RETURNED", userId, note: "All goods returned" } });
  }
}

// ---- reading ----

export const orderSorts = documentSorts({ number: "asc" });

export type OrderFilter = { status?: OrderStatus; channel?: OrderChannel; districtId?: string; from?: string; to?: string; q?: string; quotations?: boolean };

export async function listOrders(organizationId: string, branchId: string, query: ListQuery = listQuery({}, { sorts: orderSorts }), filter: OrderFilter = {}): Promise<Paged<{ id: string; number: string | null; quotationNumber: string | null; isQuotation: boolean; status: OrderStatus; channel: OrderChannel; total: string; businessDate: string; expectedDate: string | null; customerName: string }>> {
  const text = filter.q?.trim() ?? "";
  const where: Prisma.SalesOrderWhereInput = {
    organizationId,
    branchId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.channel ? { channel: filter.channel } : {}),
    ...(filter.districtId ? { districtId: filter.districtId } : {}),
    ...(filter.quotations === undefined ? {} : { isQuotation: filter.quotations }),
    ...(filter.from || filter.to ? { businessDate: { ...(filter.from ? { gte: occurredDate(filter.from) } : {}), ...(filter.to ? { lte: occurredDate(filter.to) } : {}) } } : {}),
    ...(text ? { OR: [{ number: { contains: text } }, { quotationNumber: { contains: text } }, { externalRef: { contains: text } }, { customer: { name: { contains: text } } }, { customer: { phone: { contains: text } } }] } : {}),
  };
  const total = await prisma.salesOrder.count({ where });
  const rows = await prisma.salesOrder.findMany({
    where,
    orderBy: query.orderBy as Prisma.SalesOrderOrderByWithRelationInput[],
    skip: query.skip,
    take: query.take,
    select: { id: true, number: true, quotationNumber: true, isQuotation: true, status: true, channel: true, total: true, businessDate: true, expectedDate: true, customer: { select: { name: true } } },
  });
  return {
    rows: rows.map((row) => ({ id: row.id, number: row.number, quotationNumber: row.quotationNumber, isQuotation: row.isQuotation, status: row.status, channel: row.channel, total: decimalString(row.total, 2), businessDate: dateOnly(row.businessDate), expectedDate: row.expectedDate ? dateOnly(row.expectedDate) : null, customerName: row.customer.name })),
    page: pageInfo(total, query, rows.length),
  };
}

const BOARD: OrderStatus[] = ["DRAFT", "CONFIRMED", "PACKED", "DISPATCHED", "DELIVERED"];

/** The board: for each status the number of orders and the latest few (cards). */
export async function orderBoard(organizationId: string, branchId: string, filter: Pick<OrderFilter, "channel" | "districtId"> = {}) {
  const base = { organizationId, branchId, isQuotation: false, ...(filter.channel ? { channel: filter.channel } : {}), ...(filter.districtId ? { districtId: filter.districtId } : {}) };
  const columns = await Promise.all(
    BOARD.map(async (status) => {
      const [count, rows] = await Promise.all([
        prisma.salesOrder.count({ where: { ...base, status } }),
        prisma.salesOrder.findMany({ where: { ...base, status }, orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }], take: 8, select: { id: true, number: true, total: true, channel: true, expectedDate: true, customer: { select: { name: true } } } }),
      ]);
      return { status, count, cards: rows.map((row) => ({ id: row.id, number: row.number, total: decimalString(row.total, 2), channel: row.channel, expectedDate: row.expectedDate ? dateOnly(row.expectedDate) : null, customerName: row.customer.name })) };
    }),
  );
  return columns;
}

export async function getOrder(organizationId: string, branchId: string, id: string) {
  const row = await prisma.salesOrder.findFirst({
    where: { id, organizationId, branchId },
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
      items: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { product: { select: { sku: true, name: true } } } },
      events: { orderBy: { createdAt: "asc" } },
      invoice: { select: { id: true, invoice: { select: { number: true } } } },
    },
  });
  if (!row) {
    return null;
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(row.events.flatMap((event) => (event.userId ? [event.userId] : [])))] }, organizationId }, select: { id: true, name: true } });
  const byUser = new Map(users.map((user) => [user.id, user.name]));
  const shipment = await prisma.shipment.findFirst({ where: { orderId: row.id, organizationId }, select: { id: true, number: true, status: true, method: true } });
  return {
    shipment,
    id: row.id,
    number: row.number,
    quotationNumber: row.quotationNumber,
    isQuotation: row.isQuotation,
    validUntil: row.validUntil ? dateOnly(row.validUntil) : null,
    status: row.status,
    channel: row.channel,
    deliveryMethod: row.deliveryMethod,
    shippingAddress: row.shippingAddress,
    externalRef: row.externalRef,
    note: row.note,
    businessDate: dateOnly(row.businessDate),
    expectedDate: row.expectedDate ? dateOnly(row.expectedDate) : null,
    warehouseId: row.warehouseId,
    customer: row.customer,
    subtotal: decimalString(row.subtotal, 2),
    discountTotal: decimalString(row.discountTotal, 2),
    headerDiscount: decimalString(row.headerDiscount, 2),
    vatTotal: decimalString(row.vatTotal, 2),
    chargesTotal: decimalString(row.chargesTotal, 2),
    total: decimalString(row.total, 2),
    invoice: row.invoice ? { id: row.invoice.id, number: row.invoice.invoice?.number ?? null } : null,
    items: row.items.map((item) => ({ id: item.id, productId: item.productId, variantId: item.variantId, sku: item.product.sku, name: item.product.name, quantity: decimalString(item.quantity, 4), unitPrice: decimalString(item.unitPrice, 2), discountAmount: decimalString(item.discountAmount, 2), vatAmount: decimalString(item.vatAmount, 2), lineTotal: decimalString(item.lineTotal, 2) })),
    events: row.events.map((event) => ({ id: event.id, from: event.fromStatus, to: event.toStatus, by: event.userId ? (byUser.get(event.userId) ?? "") : "", note: event.note, at: event.createdAt.toISOString() })),
  };
}
