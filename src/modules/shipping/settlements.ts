import { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { moneyAccountFor } from "@/core/ledger/accounts";
import { decimalString, money, parseMoney, zero } from "@/core/money";
import { partyBalances } from "@/core/parties";
import type { PostLine } from "@/core/posting/journal";
import { addDays, businessDate, dateOnly, daysBetween } from "@/core/time/business-date";
import { occurredDate } from "@/lib/format/date";
import { prisma } from "@/lib/db/client";
import { postBalancedJournal } from "@/modules/accounting/post";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { StockRuleError } from "@/modules/inventory/stock";
import { failure, type Actor } from "@/modules/purchasing/common";

// What a courier pays back (P07 tasks 7 and 8, #27). The courier collected the customers' cash and owes it to the shop, less its delivery charge
// and the condition charge it keeps. The shop picks the courier, ticks the delivered parcels that are not settled yet, sees the gross cash, the
// charges and what should come, and records what came and where it went. A parcel is in one settlement only. If what came is not what should
// have, the difference needs a reason and the owner's approval, and goes to its own account (a shortage to the condition charge, an excess to
// other income); the courier's account is cleared either way.

type Tx = Prisma.TransactionClient;
const ZERO = zero();
/** A parcel delivered this long ago and not yet settled is worth a call to the courier. */
export const OVERDUE_DAYS = 7;

/** What a shipment settles on the courier's account. A delivered parcel: the cash less what the courier charges and keeps. A parcel that came back: minus what is owed for it. */
function settles(row: { status: string; codAmount: Prisma.Decimal; deliveryCharge: Prisma.Decimal; deliveryPaidWith: string | null; conditionCharge: Prisma.Decimal; returnCharge: Prisma.Decimal }) {
  const delivery = row.deliveryPaidWith === "DEDUCT" ? row.deliveryCharge : ZERO;
  if (row.status === "RETURNED") {
    return { cod: ZERO, delivery, condition: ZERO, returned: row.returnCharge, amount: delivery.plus(row.returnCharge).neg() };
  }
  return { cod: row.codAmount, delivery, condition: row.conditionCharge, returned: ZERO, amount: row.codAmount.minus(delivery).minus(row.conditionCharge) };
}

export type SettleInput = {
  courierId: string;
  shipmentIds: string[];
  businessDate: string;
  /** What came in. */
  netReceived: string;
  /** The cash, bank or mobile account it came into (the default cash drawer when left out). */
  accountId?: string;
  differenceReason?: string;
  /** The user may approve a difference (couriers.approve_difference). */
  canApproveDifference?: boolean;
};

export function settleCourier(actor: Actor, input: SettleInput) {
  const hash = hashPayload({ courierId: input.courierId, shipmentIds: [...input.shipmentIds].sort(), businessDate: input.businessDate, netReceived: input.netReceived, accountId: input.accountId ?? null, reason: input.differenceReason ?? null });
  return (async () => {
    try {
      const data = await idempotentTransaction(async (tx: Tx) => {
        const existing = await readIdempotency(tx, { organizationId: actor.organizationId, key: actor.idempotencyKey, requestHash: hash });
        if (existing === "mismatch") {
          throw new StockRuleError("This idempotency key was already used for a different request.", 409);
        }
        if (existing) {
          const row = await tx.courierSettlement.findFirst({ where: { id: existing.entityId, organizationId: actor.organizationId }, select: { id: true, number: true, netReceived: true } });
          return { id: existing.entityId, number: row?.number ?? null, netReceived: row ? decimalString(row.netReceived, 2) : null, replayed: true };
        }
        const ids = [...new Set(input.shipmentIds)];
        if (ids.length === 0) {
          throw new RuleError("Tick the parcels this settlement is for.");
        }
        // one settlement at a time for a courier
        const courier = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM couriers WHERE id = ${input.courierId} AND organizationId = ${actor.organizationId} FOR UPDATE`;
        if (!courier[0]) {
          throw new RuleError("That courier was not found.", 404);
        }
        const shipments = await tx.shipment.findMany({ where: { id: { in: ids }, organizationId: actor.organizationId, branchId: actor.branchId, courierId: input.courierId } });
        if (shipments.length !== ids.length) {
          throw new RuleError("A parcel is not this courier's, or not on this branch.", 404);
        }
        if (shipments.some((row) => row.status !== "DELIVERED" && row.status !== "RETURNED")) {
          throw new RuleError("Only delivered parcels, and parcels that came back, are settled.", 409);
        }
        const taken = await tx.courierSettlementItem.findFirst({ where: { shipmentId: { in: ids } }, select: { id: true } });
        if (taken) {
          throw new RuleError("A parcel was already settled.", 409);
        }
        const lines = shipments.map((row) => ({ row, ...settles(row) }));
        const gross = money(lines.reduce((sum, line) => sum.plus(line.cod), ZERO));
        const deliveryCharges = money(lines.reduce((sum, line) => sum.plus(line.delivery), ZERO));
        const conditionCharges = money(lines.reduce((sum, line) => sum.plus(line.condition), ZERO));
        const expected = money(lines.reduce((sum, line) => sum.plus(line.amount), ZERO));
        if (expected.lte(0)) {
          throw new RuleError("These parcels leave nothing for the courier to pay: add delivered parcels to the settlement.");
        }
        const received = parseMoney(input.netReceived);
        if (!received || received.isNeg() || received.gt(expected.mul(10).plus(1000000))) {
          throw new RuleError("Enter what the courier paid, with up to two decimals.");
        }
        const difference = money(received.minus(expected));
        const reason = input.differenceReason?.trim() ?? "";
        if (!difference.isZero()) {
          if (reason.length < 3) {
            throw new RuleError(`What came (${decimalString(received, 2)}) is not what should have (${decimalString(expected, 2)}): give the reason.`);
          }
          if (!input.canApproveDifference) {
            throw new RuleError("A difference needs the owner's approval.");
          }
        }
        const account = received.gt(0) ? await moneyAccountFor(tx, actor.organizationId, { method: input.accountId ? "BANK" : "CASH", accountId: input.accountId }) : null;
        const number = await allocateNumber(tx, { organizationId: actor.organizationId, documentType: "SET", businessDate: input.businessDate });
        const settlement = await tx.courierSettlement.create({
          data: {
            organizationId: actor.organizationId,
            branchId: actor.branchId,
            courierId: input.courierId,
            accountId: account ?? (await moneyAccountFor(tx, actor.organizationId, { method: "CASH" })),
            number,
            businessDate: occurredDate(input.businessDate),
            grossCod: gross,
            deliveryCharges,
            conditionCharges,
            expected,
            netReceived: received,
            difference,
            differenceReason: difference.isZero() ? null : reason,
            approvedById: difference.isZero() ? null : actor.userId,
            createdById: actor.userId,
            items: { create: lines.map((line) => ({ organizationId: actor.organizationId, shipmentId: line.row.id, codAmount: line.cod, deliveryCharge: line.delivery, conditionCharge: line.condition, amount: line.amount })) },
          },
          select: { id: true },
        });
        const party = { type: "COURIER" as const, id: input.courierId };
        const short = difference.isNeg() ? difference.neg() : ZERO;
        const excess = difference.isNeg() ? ZERO : difference;
        const journal: PostLine[] = [
          ...(account ? [{ accountId: account, debit: received, credit: ZERO }] : []),
          ...(short.gt(0) ? [{ role: "COD_CHARGE" as const, debit: short, credit: ZERO }] : []),
          { role: "COURIER_AR" as const, debit: ZERO, credit: expected, party },
          ...(excess.gt(0) ? [{ role: "OTHER_INCOME" as const, debit: ZERO, credit: excess }] : []),
        ];
        const journalId = await postBalancedJournal(tx, { organizationId: actor.organizationId, branchId: actor.branchId, businessDate: occurredDate(input.businessDate), description: `Courier settlement ${number}`, createdById: actor.userId, doc: { type: "COURIER_SETTLEMENT", id: settlement.id }, lines: journal });
        await tx.courierSettlement.update({ where: { id: settlement.id }, data: { journalId } });
        await saveIdempotency(tx, { organizationId: actor.organizationId, userId: actor.userId, key: actor.idempotencyKey, requestHash: hash, entityType: "courier_settlement", entityId: settlement.id });
        return { id: settlement.id, number: number as string | null, netReceived: decimalString(received, 2) as string | null, replayed: false };
      });
      if (!data.replayed) {
        await writeAudit({ organizationId: actor.organizationId, branchId: actor.branchId, userId: actor.userId, action: "settle", module: "couriers", entityType: "courier_settlement", entityId: data.id, after: { number: data.number, netReceived: data.netReceived }, ip: actor.ip, userAgent: actor.userAgent });
      }
      return { ok: true as const, ...data };
    } catch (error) {
      const mapped = failure(error);
      if (mapped) {
        return mapped;
      }
      throw error;
    }
  })();
}

/** The parcels of a courier that wait to be settled (delivered, or come back), oldest first, with what each settles. */
export async function unsettledParcels(organizationId: string, branchId: string, courierId: string) {
  const rows = await prisma.shipment.findMany({
    where: { organizationId, branchId, courierId, status: { in: ["DELIVERED", "RETURNED"] }, settlementItem: null },
    orderBy: [{ deliveredOn: "asc" }, { returnedOn: "asc" }, { createdAt: "asc" }],
    take: 500,
    select: { id: true, number: true, status: true, trackingCode: true, codAmount: true, deliveryCharge: true, deliveryPaidWith: true, conditionCharge: true, returnCharge: true, deliveredOn: true, returnedOn: true, customer: { select: { name: true } } },
  });
  const today = businessDate();
  return rows.map((row) => {
    const since = row.deliveredOn ?? row.returnedOn;
    const parts = settles(row);
    return {
      id: row.id,
      number: row.number,
      status: row.status as "DELIVERED" | "RETURNED",
      trackingCode: row.trackingCode,
      customerName: row.customer?.name ?? "",
      cod: decimalString(parts.cod, 2),
      delivery: decimalString(parts.delivery, 2),
      condition: decimalString(parts.condition, 2),
      amount: decimalString(parts.amount, 2),
      since: since ? dateOnly(since) : null,
      daysWaiting: since ? Math.max(daysBetween(dateOnly(since), today), 0) : 0,
    };
  });
}

export type CourierDue = {
  courierId: string;
  name: string;
  /** What the courier owes the shop now, from the books (the courier's receivable). */
  owed: string;
  inTransit: number;
  waiting: number;
  waitingAmount: string;
  overdue: number;
  oldestDays: number;
};

/** The condition dashboard (P07 task 8): for each courier what it owes, what is on the way, what waits to be settled and what has waited too long. */
export async function courierDues(organizationId: string, branchId: string): Promise<CourierDue[]> {
  const couriers = await prisma.courier.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true } });
  const balances = await partyBalances(prisma, { organizationId, partyType: "COURIER", partyIds: couriers.map((courier) => courier.id) });
  const onTheWay = await prisma.shipment.groupBy({ by: ["courierId"], where: { organizationId, branchId, status: { in: ["CREATED", "PICKED", "IN_TRANSIT"] }, courierId: { not: null } }, _count: { _all: true } });
  const waitingRows = await prisma.shipment.findMany({
    where: { organizationId, branchId, status: { in: ["DELIVERED", "RETURNED"] }, settlementItem: null, courierId: { not: null } },
    select: { courierId: true, status: true, codAmount: true, deliveryCharge: true, deliveryPaidWith: true, conditionCharge: true, returnCharge: true, deliveredOn: true, returnedOn: true },
  });
  const today = businessDate();
  const limit = addDays(today, -OVERDUE_DAYS);
  return couriers.flatMap((courier) => {
    const mine = waitingRows.filter((row) => row.courierId === courier.id);
    const owed = balances.get(courier.id)?.balance ?? ZERO;
    const transit = onTheWay.find((row) => row.courierId === courier.id)?._count._all ?? 0;
    if (courier.status === "INACTIVE" && mine.length === 0 && transit === 0 && owed.isZero()) {
      return [];
    }
    const days = mine.map((row) => {
      const since = row.deliveredOn ?? row.returnedOn;
      return since ? Math.max(daysBetween(dateOnly(since), today), 0) : 0;
    });
    return [
      {
        courierId: courier.id,
        name: courier.name,
        owed: decimalString(owed, 2),
        inTransit: transit,
        waiting: mine.length,
        waitingAmount: decimalString(mine.reduce((sum, row) => sum.plus(settles(row).amount), ZERO), 2),
        overdue: mine.filter((row) => {
          const since = row.deliveredOn ?? row.returnedOn;
          return since !== null && dateOnly(since) <= limit;
        }).length,
        oldestDays: days.length > 0 ? Math.max(...days) : 0,
      },
    ];
  });
}

export async function listSettlements(organizationId: string, branchId: string, courierId?: string) {
  const rows = await prisma.courierSettlement.findMany({
    where: { organizationId, branchId, ...(courierId ? { courierId } : {}) },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: { id: true, number: true, businessDate: true, grossCod: true, deliveryCharges: true, conditionCharges: true, expected: true, netReceived: true, difference: true, differenceReason: true, courier: { select: { name: true } }, items: { select: { id: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    businessDate: dateOnly(row.businessDate),
    courierName: row.courier.name,
    parcels: row.items.length,
    grossCod: decimalString(row.grossCod, 2),
    deliveryCharges: decimalString(row.deliveryCharges, 2),
    conditionCharges: decimalString(row.conditionCharges, 2),
    expected: decimalString(row.expected, 2),
    netReceived: decimalString(row.netReceived, 2),
    difference: decimalString(row.difference, 2),
    differenceReason: row.differenceReason,
  }));
}
