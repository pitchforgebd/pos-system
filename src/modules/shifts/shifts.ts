import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { hashPayload, readIdempotency, saveIdempotency } from "@/modules/inventory/idempotency";
import { decimalString, parseMoney } from "@/modules/inventory/money";
import { StockRuleError } from "@/modules/inventory/stock";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
};

type ShiftStatus = "OPEN" | "ACTIVE" | "CLOSING" | "CLOSED";

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2);
}

function zero() {
  return new Prisma.Decimal(0);
}

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const code = error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return { ok: false, status: error.status, code, message: error.message };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

function amount(value: Prisma.Decimal | null) {
  return value ? decimalString(value, 2) : null;
}

function present(row: {
  id: string;
  status: ShiftStatus;
  openingCash: Prisma.Decimal | null;
  cashSales: Prisma.Decimal | null;
  cashIn: Prisma.Decimal | null;
  cashOut: Prisma.Decimal | null;
  refunds: Prisma.Decimal | null;
  expectedCash: Prisma.Decimal | null;
  actualCash: Prisma.Decimal | null;
  difference: Prisma.Decimal | null;
  openedAt: Date;
  closedAt: Date | null;
  user: { id: string; name: string };
}) {
  return {
    id: row.id,
    userId: row.user.id,
    cashierName: row.user.name,
    status: row.status,
    openingCash: amount(row.openingCash),
    cashSales: amount(row.cashSales),
    cashIn: amount(row.cashIn),
    cashOut: amount(row.cashOut),
    refunds: amount(row.refunds),
    expectedCash: amount(row.expectedCash),
    actualCash: amount(row.actualCash),
    difference: amount(row.difference),
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

const shiftSelect = {
  id: true,
  status: true,
  openingCash: true,
  cashSales: true,
  cashIn: true,
  cashOut: true,
  refunds: true,
  expectedCash: true,
  actualCash: true,
  difference: true,
  openedAt: true,
  closedAt: true,
  user: { select: { id: true, name: true } },
} as const;

async function lockShift(tx: Prisma.TransactionClient, organizationId: string, branchId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: ShiftStatus; userId: string; openedAt: Date; openingCash: Prisma.Decimal | null }>>`
    SELECT id, status, userId, openedAt, openingCash FROM shifts
    WHERE id = ${id} AND organizationId = ${organizationId} AND branchId = ${branchId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new StockRuleError("That record was not found.", 404);
  }
  return row;
}

async function remember(tx: Prisma.TransactionClient, input: Actor & { requestHash: string; entityType: string; entityId: string }) {
  await saveIdempotency(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    entityType: input.entityType,
    entityId: input.entityId,
  });
}

async function replay(tx: Prisma.TransactionClient, input: Actor & { requestHash: string }) {
  const existing = await readIdempotency(tx, {
    organizationId: input.organizationId,
    key: input.idempotencyKey,
    requestHash: input.requestHash,
  });
  if (existing === "mismatch") {
    throw new StockRuleError("This idempotency key was already used for a different request.", 409);
  }
  return existing;
}

export async function listShifts(organizationId: string, branchId: string) {
  const rows = await prisma.shift.findMany({
    where: { organizationId, branchId },
    orderBy: { openedAt: "desc" },
    take: 100,
    select: shiftSelect,
  });
  return rows.map(present);
}

export async function getShift(organizationId: string, branchId: string, id: string) {
  const row = await prisma.shift.findFirst({ where: { id, organizationId, branchId }, select: shiftSelect });
  if (!row) {
    return null;
  }
  const [movements, handovers] = await Promise.all([
    prisma.cashMovement.findMany({
      where: { shiftId: row.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, direction: true, amount: true, reason: true },
    }),
    prisma.cashHandover.findMany({
      where: { shiftId: row.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, amount: true, toUser: { select: { name: true } } },
    }),
  ]);
  return {
    ...present(row),
    movements: movements.map((movement) => ({
      id: movement.id,
      direction: movement.direction,
      amount: decimalString(movement.amount, 2),
      reason: movement.reason,
    })),
    handovers: handovers.map((handover) => ({
      id: handover.id,
      amount: decimalString(handover.amount, 2),
      toName: handover.toUser.name,
    })),
  };
}

export async function listHandoverUsers(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true },
  });
}

export async function openShift(input: Actor & { openingCash: string }) {
  const openingCash = parseMoney(input.openingCash);
  if (!openingCash) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter opening cash with up to two decimals." };
  }
  const requestHash = hashPayload({ openingCash: input.openingCash });
  try {
    const data = await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const open = await tx.shift.findFirst({
        where: { organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, status: { not: "CLOSED" } },
        select: { id: true },
      });
      if (open) {
        throw new StockRuleError("This user already has a shift open on this branch.");
      }
      const shift = await tx.shift.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          userId: input.userId,
          status: "OPEN",
          openingCash,
        },
        select: { id: true },
      });
      await remember(tx, { ...input, requestHash, entityType: "shift", entityId: shift.id });
      return { id: shift.id, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "open",
        module: "shifts",
        entityType: "shift",
        entityId: data.id,
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

export async function activateShift(input: Actor & { shiftId: string }) {
  const requestHash = hashPayload({ shiftId: input.shiftId, action: "activate" });
  try {
    const data = await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const current = await lockShift(tx, input.organizationId, input.branchId, input.shiftId);
      if (current.status !== "OPEN") {
        throw new StockRuleError("Only an opened shift can become active.");
      }
      await tx.shift.update({ where: { id: current.id }, data: { status: "ACTIVE" } });
      await remember(tx, { ...input, requestHash, entityType: "shift_activate", entityId: current.id });
      return { id: current.id, replayed: false };
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

export async function postCashMovement(input: Actor & { shiftId: string; direction: "IN" | "OUT"; amount: string; reason?: string | null }) {
  const amountValue = parseMoney(input.amount);
  if (!amountValue || amountValue.lte(0)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a movement amount greater than zero." };
  }
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 255) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "The reason is too long." };
  }
  const requestHash = hashPayload({ shiftId: input.shiftId, direction: input.direction, amount: input.amount, reason });
  try {
    const data = await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const current = await lockShift(tx, input.organizationId, input.branchId, input.shiftId);
      if (current.status !== "ACTIVE") {
        throw new StockRuleError("Cash can move only while the shift is active.");
      }
      const movement = await tx.cashMovement.create({
        data: {
          organizationId: input.organizationId,
          shiftId: current.id,
          direction: input.direction,
          amount: amountValue,
          reason,
          userId: input.userId,
        },
        select: { id: true },
      });
      await remember(tx, { ...input, requestHash, entityType: "cash_movement", entityId: movement.id });
      return { id: movement.id, replayed: false };
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

async function drawerTotals(tx: Prisma.TransactionClient, shift: { id: string; openedAt: Date | string; openingCash: Prisma.Decimal | string | null }, organizationId: string, branchId: string) {
  const movements = await tx.cashMovement.findMany({ where: { shiftId: shift.id }, select: { direction: true, amount: true } });
  let cashIn = zero();
  let cashOut = zero();
  for (const movement of movements) {
    if (movement.direction === "IN") {
      cashIn = cashIn.plus(movement.amount);
    } else {
      cashOut = cashOut.plus(movement.amount);
    }
  }
  const payments = await tx.salePayment.findMany({
    where: {
      organizationId,
      method: "CASH",
      createdAt: { gte: new Date(shift.openedAt) },
      sale: { branchId, status: "POSTED" },
    },
    select: { amount: true },
  });
  const cashSales = payments.reduce((sum, payment) => sum.plus(payment.amount), zero());
  const returns = await tx.saleReturn.findMany({
    where: { organizationId, branchId, status: "POSTED", createdAt: { gte: new Date(shift.openedAt) } },
    select: { journal: { select: { lines: { select: { credit: true, account: { select: { code: true } } } } } } },
  });
  let refunds = zero();
  for (const saleReturn of returns) {
    for (const line of saleReturn.journal?.lines ?? []) {
      if (line.account.code === "1100") {
        refunds = refunds.plus(line.credit);
      }
    }
  }
  const opening = new Prisma.Decimal(shift.openingCash ?? 0);
  const expected = money(opening.plus(cashSales).plus(cashIn).minus(cashOut).minus(refunds));
  return {
    cashSales: money(cashSales),
    cashIn: money(cashIn),
    cashOut: money(cashOut),
    refunds: money(refunds),
    expected,
  };
}

export async function countShift(input: Actor & { shiftId: string; actualCash: string }) {
  const actualCash = parseMoney(input.actualCash);
  if (!actualCash) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter the actual cash with up to two decimals." };
  }
  const requestHash = hashPayload({ shiftId: input.shiftId, actualCash: input.actualCash });
  try {
    const data = await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const current = await lockShift(tx, input.organizationId, input.branchId, input.shiftId);
      if (current.status !== "ACTIVE") {
        throw new StockRuleError("Count the drawer only while the shift is active.");
      }
      const totals = await drawerTotals(tx, current, input.organizationId, input.branchId);
      const difference = money(actualCash.minus(totals.expected));
      await tx.shift.update({
        where: { id: current.id },
        data: {
          status: "CLOSING",
          cashSales: totals.cashSales,
          cashIn: totals.cashIn,
          cashOut: totals.cashOut,
          refunds: totals.refunds,
          expectedCash: totals.expected,
          actualCash,
          difference,
        },
      });
      await remember(tx, { ...input, requestHash, entityType: "shift_count", entityId: current.id });
      return { id: current.id, replayed: false, expectedCash: decimalString(totals.expected, 2), difference: decimalString(difference, 2) };
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

export async function closeShift(input: Actor & { shiftId: string }) {
  const requestHash = hashPayload({ shiftId: input.shiftId, action: "close" });
  try {
    const data = await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const current = await lockShift(tx, input.organizationId, input.branchId, input.shiftId);
      if (current.status === "CLOSED") {
        throw new StockRuleError("A closed shift cannot close again.");
      }
      if (current.status !== "CLOSING") {
        throw new StockRuleError("Count the drawer before closing the shift.");
      }
      await tx.shift.update({ where: { id: current.id }, data: { status: "CLOSED", closedAt: new Date() } });
      await remember(tx, { ...input, requestHash, entityType: "shift_close", entityId: current.id });
      return { id: current.id, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "close",
        module: "shifts",
        entityType: "shift",
        entityId: data.id,
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

export async function handOverShift(input: Actor & { shiftId: string; toUserId: string; amount: string }) {
  const amountValue = parseMoney(input.amount);
  if (!amountValue || amountValue.lte(0)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a handover amount greater than zero." };
  }
  const requestHash = hashPayload({ shiftId: input.shiftId, toUserId: input.toUserId, amount: input.amount });
  try {
    const data = await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const current = await lockShift(tx, input.organizationId, input.branchId, input.shiftId);
      if (current.status !== "CLOSING") {
        throw new StockRuleError("Hand the drawer over while the shift is closing.");
      }
      if (input.toUserId === current.userId) {
        throw new StockRuleError("Choose a different user for the handover.");
      }
      const recipient = await tx.user.findFirst({
        where: { id: input.toUserId, organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!recipient) {
        throw new StockRuleError("That record was not found.", 404);
      }
      const handover = await tx.cashHandover.create({
        data: {
          organizationId: input.organizationId,
          shiftId: current.id,
          fromUserId: current.userId,
          toUserId: recipient.id,
          amount: amountValue,
        },
        select: { id: true },
      });
      await remember(tx, { ...input, requestHash, entityType: "cash_handover", entityId: handover.id });
      return { id: handover.id, replayed: false };
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
