import { createHash } from "node:crypto";

import { Prisma, type DeliveryMethod, type ShipmentStatus } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { moneyAccountFor } from "@/core/ledger/accounts";
import { documentSorts, listQuery, pageInfo, type ListQuery, type Paged } from "@/core/list";
import { decimalString, money, parseMoney, zero } from "@/core/money";
import { invoicePayment } from "@/core/payments";
import type { PostLine } from "@/core/posting/journal";
import { dateOnly, isIsoDate } from "@/core/time/business-date";
import { runTx } from "@/core/tx/run";
import { occurredDate } from "@/lib/format/date";
import { prisma } from "@/lib/db/client";
import { postBalancedJournal } from "@/modules/accounting/post";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { StockRuleError } from "@/modules/inventory/stock";
import { failure, type Actor } from "@/modules/purchasing/common";
import { postSaleReturn } from "@/modules/sales/returns";

// A sale's delivery (P07 tasks 3, 4, 5, feature 7). By the shop's own vehicle the fare is an expense (#29). By courier the parcel is handed over
// with the customer's cash to collect (COD): the courier owes it to the shop (#24), less what it charges to deliver (#25) and what it keeps of the
// cash (the condition charge, #26); all three post together, in the same transaction as the invoice of the dispatch. A parcel that comes back gives the
// receivable back to the customer (#28) and the sale is returned in full (#21); a parcel that is delivered waits for the courier's settlement.

type Tx = Prisma.TransactionClient;
const ZERO = zero();

export type ShipmentInput = {
  courierId?: string;
  trackingCode?: string;
  /** Picks the courier's charge for a delivery outside Dhaka. */
  outsideDhaka?: boolean;
  /** Overrides the courier's default charge. */
  deliveryCharge?: string;
  /** Overrides the courier's default condition percentage. */
  conditionPercent?: string;
  /** The cash the courier collects; what the customer still owes on the invoice when left out. */
  codAmount?: string;
  /** How the delivery charge is paid: DEDUCT (kept out of the settlement, the default for a courier), CASH or BANK (paid now). */
  deliveryPaidWith?: "DEDUCT" | "CASH" | "BANK";
  deliveryAccountId?: string;
  /** Own vehicle. */
  vehicleNo?: string;
  driverName?: string;
  driverPhone?: string;
};

const amountOf = (value: string | undefined, what: string) => {
  const parsed = parseMoney((value ?? "0").trim() || "0");
  if (!parsed || parsed.isNeg()) {
    throw new RuleError(`Enter ${what} with up to two decimals.`);
  }
  return parsed;
};

async function eventOf(tx: Tx, actor: Actor, shipmentId: string, status: ShipmentStatus, note?: string) {
  await tx.shipmentEvent.create({ data: { organizationId: actor.organizationId, shipmentId, status, note: note ?? null, userId: actor.userId } });
}

/**
 * Makes the shipment of a dispatched order, in the dispatch's own transaction (called from the invoice's hook), so the invoice, the stock out, the
 * handover and the charges are all there or none is. PICKUP makes none.
 */
export async function createShipmentInTx(
  tx: Tx,
  actor: Actor,
  input: { saleId: string; customerId: string; businessDate: string; order: { id: string; deliveryMethod: DeliveryMethod; shippingAddress: string | null }; shipment?: ShipmentInput },
) {
  const { order } = input;
  if (order.deliveryMethod === "PICKUP") {
    return null;
  }
  const given = input.shipment ?? {};
  const number = await allocateNumber(tx, { organizationId: actor.organizationId, documentType: "SHP", businessDate: input.businessDate });
  const day = occurredDate(input.businessDate);
  const party = { type: "CUSTOMER" as const, id: input.customerId };

  if (order.deliveryMethod === "OWN_VEHICLE") {
    // #29: the vehicle's fare, paid out of the till or the bank, is an expense
    const fare = amountOf(given.deliveryCharge, "the fare");
    const paidWith = given.deliveryPaidWith === "BANK" ? "BANK" : "CASH";
    const row = await tx.shipment.create({
      data: {
        organizationId: actor.organizationId,
        branchId: actor.branchId,
        number,
        saleId: input.saleId,
        orderId: order.id,
        method: "OWN_VEHICLE",
        customerId: input.customerId,
        vehicleNo: given.vehicleNo?.trim() || null,
        driverName: given.driverName?.trim() || null,
        driverPhone: given.driverPhone?.trim() || null,
        address: order.shippingAddress,
        status: "CREATED",
        deliveryCharge: fare,
        deliveryPaidWith: fare.gt(0) ? paidWith : null,
        deliveryAccountId: null,
        dispatchedOn: day,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    if (fare.gt(0)) {
      const account = await moneyAccountFor(tx, actor.organizationId, { method: paidWith, accountId: given.deliveryAccountId });
      const journalId = await postBalancedJournal(tx, {
        organizationId: actor.organizationId,
        branchId: actor.branchId,
        businessDate: day,
        description: `Delivery ${number}`,
        createdById: actor.userId,
        doc: { type: "SHIPMENT", id: row.id },
        lines: [
          { role: "TRANSPORT", debit: fare, credit: ZERO },
          { accountId: account, debit: ZERO, credit: fare },
        ],
      });
      await tx.shipment.update({ where: { id: row.id }, data: { journalId, deliveryAccountId: account } });
    }
    await eventOf(tx, actor, row.id, "CREATED", "Own vehicle");
    return { id: row.id, number };
  }

  // by courier
  if (!given.courierId) {
    throw new RuleError("Choose the courier.");
  }
  const courier = await tx.courier.findFirst({ where: { id: given.courierId, organizationId: actor.organizationId, status: "ACTIVE" } });
  if (!courier) {
    throw new RuleError("That courier was not found.", 404);
  }
  const owed = (await invoicePayment(tx, actor.organizationId, input.saleId)).owed;
  const cod = given.codAmount === undefined || given.codAmount.trim() === "" ? owed : amountOf(given.codAmount, "the cash on delivery");
  if (cod.gt(owed)) {
    throw new RuleError(`The cash on delivery is more than the ${decimalString(owed, 2)} the customer still owes on the invoice.`);
  }
  const delivery = given.deliveryCharge !== undefined && given.deliveryCharge.trim() !== "" ? amountOf(given.deliveryCharge, "the delivery charge") : given.outsideDhaka ? courier.outsideDeliveryCharge : courier.defaultDeliveryCharge;
  const percentText = (given.conditionPercent ?? "").trim();
  if (percentText !== "" && (!/^\d{1,3}(\.\d{1,2})?$/.test(percentText) || Number(percentText) > 100)) {
    throw new RuleError("The condition charge is between 0 and 100 percent, with up to two decimals.");
  }
  const percent = percentText === "" ? courier.defaultConditionPercent : new Prisma.Decimal(percentText);
  const condition = money(cod.mul(percent).div(100));
  const paidWith = given.deliveryPaidWith ?? "DEDUCT";
  if (delivery.gt(0) && paidWith !== "DEDUCT" && paidWith !== "CASH" && paidWith !== "BANK") {
    throw new RuleError("The delivery charge is deducted from the settlement, or paid in cash or by bank.");
  }
  const account = delivery.gt(0) && paidWith !== "DEDUCT" ? await moneyAccountFor(tx, actor.organizationId, { method: paidWith, accountId: given.deliveryAccountId }) : null;

  const row = await tx.shipment.create({
    data: {
      organizationId: actor.organizationId,
      branchId: actor.branchId,
      number,
      saleId: input.saleId,
      orderId: order.id,
      method: "COURIER",
      courierId: courier.id,
      customerId: input.customerId,
      trackingCode: given.trackingCode?.trim() || null,
      address: order.shippingAddress,
      status: "CREATED",
      codAmount: cod,
      deliveryCharge: delivery,
      conditionPercent: percent,
      conditionCharge: condition,
      deliveryPaidWith: delivery.gt(0) ? paidWith : null,
      deliveryAccountId: account,
      dispatchedOn: day,
      createdById: actor.userId,
    },
    select: { id: true },
  });
  const courierParty = { type: "COURIER" as const, id: courier.id };
  const lines: PostLine[] = [
    // #24: the courier took the customer's cash to collect; it owes it to the shop
    ...(cod.gt(0)
      ? [
          { role: "COURIER_AR" as const, debit: cod, credit: ZERO, party: courierParty },
          { role: "AR" as const, debit: ZERO, credit: cod, party },
        ]
      : []),
    // #25: what the courier charges to deliver, kept out of what it pays back (or paid now)
    ...(delivery.gt(0)
      ? [
          { role: "TRANSPORT" as const, debit: delivery, credit: ZERO },
          account ? { accountId: account, debit: ZERO, credit: delivery } : { role: "COURIER_AR" as const, debit: ZERO, credit: delivery, party: courierParty },
        ]
      : []),
    // #26: what it keeps of the cash
    ...(condition.gt(0)
      ? [
          { role: "COD_CHARGE" as const, debit: condition, credit: ZERO },
          { role: "COURIER_AR" as const, debit: ZERO, credit: condition, party: courierParty },
        ]
      : []),
  ];
  if (lines.length > 0) {
    const journalId = await postBalancedJournal(tx, {
      organizationId: actor.organizationId,
      branchId: actor.branchId,
      businessDate: day,
      description: `Shipment ${number}`,
      createdById: actor.userId,
      doc: { type: "SHIPMENT", id: row.id },
      lines,
    });
    await tx.shipment.update({ where: { id: row.id }, data: { journalId } });
    if (cod.gt(0)) {
      // the courier now owes the invoice's cash: the handover settles that much of the invoice
      await tx.paymentAllocation.create({ data: { organizationId: actor.organizationId, journalId, invoiceId: input.saleId, amount: cod } });
    }
  }
  await eventOf(tx, actor, row.id, "CREATED", courier.name);
  return { id: row.id, number };
}

// ---- moving a shipment ----

type Outcome = { id: string; status: ShipmentStatus; replayed: boolean };

async function operate(actor: Actor, kind: string, extra: unknown, work: (tx: Tx) => Promise<Omit<Outcome, "replayed">>) {
  const hash = hashPayload({ kind, extra });
  try {
    const outcome = await idempotentTransaction(async (tx): Promise<Outcome> => {
      const existing = await readIdempotency(tx, { organizationId: actor.organizationId, key: actor.idempotencyKey, requestHash: hash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        const row = await tx.shipment.findFirst({ where: { id: existing.entityId, organizationId: actor.organizationId }, select: { id: true, status: true } });
        return { id: existing.entityId, status: row?.status ?? "CREATED", replayed: true };
      }
      const done = await work(tx);
      await saveIdempotency(tx, { organizationId: actor.organizationId, userId: actor.userId, key: actor.idempotencyKey, requestHash: hash, entityType: "shipment", entityId: done.id });
      return { ...done, replayed: false };
    });
    if (!outcome.replayed) {
      await writeAudit({ organizationId: actor.organizationId, branchId: actor.branchId, userId: actor.userId, action: kind, module: "shipments", entityType: "shipment", entityId: outcome.id, after: { status: outcome.status }, ip: actor.ip, userAgent: actor.userAgent });
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

async function lockShipment(tx: Tx, actor: Actor, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM shipments WHERE id = ${id} AND organizationId = ${actor.organizationId} AND branchId = ${actor.branchId} FOR UPDATE
  `;
  if (!rows[0]) {
    throw new RuleError("That record was not found.", 404);
  }
  return tx.shipment.findUniqueOrThrow({ where: { id } });
}

const FORWARD: Record<ShipmentStatus, ShipmentStatus[]> = {
  CREATED: ["PICKED", "IN_TRANSIT", "DELIVERED", "LOST"],
  PICKED: ["IN_TRANSIT", "DELIVERED", "LOST"],
  IN_TRANSIT: ["DELIVERED", "LOST"],
  DELIVERED: [],
  RETURNED: [],
  LOST: [],
};

/** PICKED, IN_TRANSIT, DELIVERED or LOST: a step of the parcel's way. A parcel that came back goes through returnShipment. */
export function moveShipment(actor: Actor, id: string, to: "PICKED" | "IN_TRANSIT" | "DELIVERED" | "LOST", input: { note?: string; on?: string } = {}) {
  return operate(actor, `move-${to}`, { id, input }, async (tx) => {
    const current = await lockShipment(tx, actor, id);
    if (!FORWARD[current.status].includes(to)) {
      throw new RuleError(`A shipment that is ${current.status.toLowerCase().replace("_", " ")} cannot be marked ${to.toLowerCase().replace("_", " ")}.`, 409);
    }
    if (input.on && !isIsoDate(input.on)) {
      throw new RuleError("Dates use YYYY-MM-DD.");
    }
    await tx.shipment.update({ where: { id }, data: { status: to, ...(to === "DELIVERED" ? { deliveredOn: occurredDate(input.on ?? dateOnly(new Date())) } : {}) } });
    await eventOf(tx, actor, id, to, input.note);
    if (to === "DELIVERED" && current.orderId) {
      // the order is delivered with its parcel
      const order = await tx.salesOrder.findFirst({ where: { id: current.orderId, organizationId: actor.organizationId }, select: { id: true, status: true } });
      if (order?.status === "DISPATCHED") {
        await tx.salesOrder.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
        await tx.orderEvent.create({ data: { organizationId: actor.organizationId, orderId: order.id, fromStatus: "DISPATCHED", toStatus: "DELIVERED", userId: actor.userId, note: "Parcel delivered" } });
      }
    }
    return { id, status: to };
  });
}

/** A key of the same shape as the caller's, made from it, for the sale return that goes with the parcel's return. */
function derivedKey(key: string, label: string) {
  const hex = createHash("sha256").update(`${key}:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The parcel was not delivered and came back (#28): the courier no longer owes the cash (Dr Receivable of the customer / Cr Courier receivable),
 * the condition charge it would have kept is reversed, what it charges for the way back is an expense (6700), and the whole sale is returned (#21):
 * the stock comes back, the sales are reversed. The customer's receivable ends where it started: nothing.
 */
export function returnShipment(actor: Actor, id: string, input: { businessDate: string; returnCharge?: string; reason?: string }) {
  return operate(actor, "return", { id, input }, async () =>
    // one transaction for the parcel's return and the sale's: if the sale cannot be returned, nothing is
    runTx(async (tx) => {
      const current = await lockShipment(tx, actor, id);
      if (current.method !== "COURIER" || !current.courierId || !current.saleId) {
        throw new RuleError("Only a parcel with a courier can come back this way.", 409);
      }
      if (!["CREATED", "PICKED", "IN_TRANSIT"].includes(current.status)) {
        throw new RuleError("Only a parcel that was not delivered can come back.", 409);
      }
      if (!isIsoDate(input.businessDate)) {
        throw new RuleError("Dates use YYYY-MM-DD.");
      }
      if (await tx.courierSettlementItem.findFirst({ where: { shipmentId: id }, select: { id: true } })) {
        throw new RuleError("That shipment was already settled.", 409);
      }
      const charge = amountOf(input.returnCharge, "the return charge");
      const sale = await tx.sale.findFirstOrThrow({ where: { id: current.saleId }, select: { id: true, customerId: true, items: { select: { id: true, quantity: true, returnItems: { where: { saleReturn: { status: "POSTED" } }, select: { id: true } } } } } });
      if (sale.items.some((item) => item.returnItems.length > 0)) {
        throw new RuleError("Part of this sale was already returned: the parcel cannot come back as a whole.", 409);
      }
      if (sale.customerId) {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${sale.customerId} AND organizationId = ${actor.organizationId} FOR UPDATE`;
      }
      const day = occurredDate(input.businessDate);
      const courierParty = { type: "COURIER" as const, id: current.courierId };
      const lines: PostLine[] = [
        ...(current.codAmount.gt(0) && sale.customerId
          ? [
              { role: "AR" as const, debit: current.codAmount, credit: ZERO, party: { type: "CUSTOMER" as const, id: sale.customerId } },
              { role: "COURIER_AR" as const, debit: ZERO, credit: current.codAmount, party: courierParty },
            ]
          : []),
        ...(current.conditionCharge.gt(0)
          ? [
              { role: "COURIER_AR" as const, debit: current.conditionCharge, credit: ZERO, party: courierParty },
              { role: "COD_CHARGE" as const, debit: ZERO, credit: current.conditionCharge },
            ]
          : []),
        ...(charge.gt(0)
          ? [
              { role: "TRANSPORT" as const, debit: charge, credit: ZERO },
              { role: "COURIER_AR" as const, debit: ZERO, credit: charge, party: courierParty },
            ]
          : []),
      ];
      if (lines.length > 0) {
        await postBalancedJournal(tx, { organizationId: actor.organizationId, branchId: actor.branchId, businessDate: day, description: `Parcel returned ${current.number ?? ""}`.trim(), createdById: actor.userId, doc: { type: "SHIPMENT_RETURN", id }, lines });
      }
      // the handover no longer settles the invoice
      if (current.journalId) {
        await tx.paymentAllocation.deleteMany({ where: { organizationId: actor.organizationId, journalId: current.journalId, invoiceId: current.saleId } });
      }
      const back = await postSaleReturn({
        ...actor,
        idempotencyKey: derivedKey(actor.idempotencyKey, "parcel-return"),
        saleId: current.saleId,
        businessDate: input.businessDate,
        lines: sale.items.map((item) => ({ saleItemId: item.id, quantity: item.quantity.toFixed(4) })),
      });
      if (!back.ok) {
        throw new RuleError(back.message, back.status);
      }
      await tx.shipment.update({ where: { id }, data: { status: "RETURNED", returnedOn: day, returnCharge: charge } });
      await eventOf(tx, actor, id, "RETURNED", input.reason?.trim() || undefined);
      return { id, status: "RETURNED" as ShipmentStatus };
    }),
  );
}

// ---- reading ----

export type ShipmentFilter = { status?: ShipmentStatus; courierId?: string; q?: string };

/** The shipment list is always newest first; the sort name is accepted so the page can use the shared list reader. */
export const shipmentSorts = documentSorts({ number: "asc" });

export async function listShipments(
  organizationId: string,
  branchId: string,
  query: ListQuery = listQuery({}, { sorts: shipmentSorts }),
  filter: ShipmentFilter = {},
): Promise<Paged<{ id: string; number: string | null; method: DeliveryMethod; status: ShipmentStatus; courierName: string | null; customerName: string | null; trackingCode: string | null; codAmount: string; dispatchedOn: string | null }>> {
  const text = filter.q?.trim() ?? "";
  const where: Prisma.ShipmentWhereInput = {
    organizationId,
    branchId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.courierId ? { courierId: filter.courierId } : {}),
    ...(text ? { OR: [{ number: { contains: text } }, { trackingCode: { contains: text } }, { vehicleNo: { contains: text } }, { customer: { name: { contains: text } } }] } : {}),
  };
  const total = await prisma.shipment.count({ where });
  const rows = await prisma.shipment.findMany({
    where,
    orderBy: [{ dispatchedOn: "desc" }, { createdAt: "desc" }],
    skip: query.skip,
    take: query.take,
    select: { id: true, number: true, method: true, status: true, trackingCode: true, codAmount: true, dispatchedOn: true, courier: { select: { name: true } }, customer: { select: { name: true } } },
  });
  return {
    rows: rows.map((row) => ({ id: row.id, number: row.number, method: row.method, status: row.status, courierName: row.courier?.name ?? null, customerName: row.customer?.name ?? null, trackingCode: row.trackingCode, codAmount: decimalString(row.codAmount, 2), dispatchedOn: row.dispatchedOn ? dateOnly(row.dispatchedOn) : null })),
    page: pageInfo(total, query, rows.length),
  };
}

export async function getShipment(organizationId: string, branchId: string, id: string) {
  const row = await prisma.shipment.findFirst({
    where: { id, organizationId, branchId },
    include: {
      courier: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true } },
      events: { orderBy: { at: "asc" } },
      settlementItem: { select: { settlement: { select: { id: true, number: true } } } },
      sale: { select: { id: true, invoice: { select: { number: true } } } },
    },
  });
  if (!row) {
    return null;
  }
  const order = row.orderId ? await prisma.salesOrder.findFirst({ where: { id: row.orderId, organizationId }, select: { id: true, number: true } }) : null;
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(row.events.flatMap((event) => (event.userId ? [event.userId] : [])))] }, organizationId }, select: { id: true, name: true } });
  const byUser = new Map(users.map((user) => [user.id, user.name]));
  const deliveryDeducted = row.deliveryPaidWith === "DEDUCT";
  return {
    id: row.id,
    number: row.number,
    method: row.method,
    status: row.status,
    courier: row.courier,
    customer: row.customer,
    trackingCode: row.trackingCode,
    vehicleNo: row.vehicleNo,
    driverName: row.driverName,
    driverPhone: row.driverPhone,
    address: row.address,
    codAmount: decimalString(row.codAmount, 2),
    deliveryCharge: decimalString(row.deliveryCharge, 2),
    deliveryPaidWith: row.deliveryPaidWith,
    conditionPercent: decimalString(row.conditionPercent, 2),
    conditionCharge: decimalString(row.conditionCharge, 2),
    returnCharge: decimalString(row.returnCharge, 2),
    /** What the courier should pay the shop for this parcel once it is delivered. */
    expectedNet: decimalString(row.codAmount.minus(deliveryDeducted ? row.deliveryCharge : ZERO).minus(row.conditionCharge), 2),
    dispatchedOn: row.dispatchedOn ? dateOnly(row.dispatchedOn) : null,
    deliveredOn: row.deliveredOn ? dateOnly(row.deliveredOn) : null,
    returnedOn: row.returnedOn ? dateOnly(row.returnedOn) : null,
    sale: row.sale ? { id: row.sale.id, number: row.sale.invoice?.number ?? null } : null,
    order,
    settlement: row.settlementItem?.settlement ?? null,
    events: row.events.map((event) => ({ id: event.id, status: event.status, note: event.note, by: event.userId ? (byUser.get(event.userId) ?? "") : "", at: event.at.toISOString() })),
  };
}
