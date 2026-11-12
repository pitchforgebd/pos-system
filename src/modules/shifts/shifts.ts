import { Prisma } from "@prisma/client";
import { runTx } from "@/core/tx/run";
import { RuleError } from "@/core/errors/rule-error";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { hashPayload, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { moneyAccountFor } from "@/core/ledger/accounts";
import { decimalString, money, parseMoney, zero } from "@/core/money";
import { postBalancedJournal } from "@/modules/accounting/post";
import { StockRuleError } from "@/modules/inventory/stock";
import { occurredDate } from "@/lib/format/date";
import { dateOnly, businessDate as today } from "@/core/time/business-date";

// A cashier's drawer (P08, N7, B5, B6, I14, D17). The cash a user takes or pays goes through their active shift: every line of a journal on a cash
// account carries the shift (the posting engine puts it there). What the drawer should hold is the opening cash plus what those lines add up to, so
// two cashiers on one branch each have their own figure. The shift is counted (notes and coins, or one total), and closing it puts what is short or
// over in the books (#39). A shop that turns shifts on (D17) cannot take or pay cash without one.

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

/** The notes and coins a drawer can hold, by value. */
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const code = error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return { ok: false, status: error.status, code, message: error.message };
  }
  if (isKeyRace(error)) {
    throw error;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

function amount(value: Prisma.Decimal | null) {
  return value ? decimalString(value, 2) : null;
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
  cashAccountId: true,
  denominations: true,
  user: { select: { id: true, name: true } },
} as const;

type ShiftRow = Prisma.ShiftGetPayload<{ select: typeof shiftSelect }>;

function present(row: ShiftRow) {
  return {
    id: row.id,
    userId: row.user.id,
    cashierName: row.user.name,
    status: row.status as ShiftStatus,
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
    cashAccountId: row.cashAccountId,
    denominations: (row.denominations ?? null) as Record<string, number> | null,
  };
}

async function lockShift(tx: Prisma.TransactionClient, organizationId: string, branchId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: ShiftStatus; userId: string; openedAt: Date; openingCash: Prisma.Decimal | null; cashAccountId: string | null }>>`
    SELECT id, status, userId, openedAt, openingCash, cashAccountId FROM shifts
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
  await saveIdempotency(tx, { organizationId: input.organizationId, userId: input.userId, key: input.idempotencyKey, requestHash: input.requestHash, entityType: input.entityType, entityId: input.entityId });
}

async function replay(tx: Prisma.TransactionClient, input: Actor & { requestHash: string }) {
  const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash: input.requestHash });
  if (existing === "mismatch") {
    throw new StockRuleError("This idempotency key was already used for a different request.", 409);
  }
  return existing;
}

/** The user's active shift on the branch, if they have one (what the register and the cash forms check). */
export async function activeShiftOf(organizationId: string, branchId: string, userId: string) {
  return prisma.shift.findFirst({ where: { organizationId, branchId, userId, status: "ACTIVE" }, select: { id: true, openedAt: true } });
}

/** Whether the shop requires a shift for cash (D17). */
export async function shiftRequired(organizationId: string) {
  return (await prisma.organization.findUnique({ where: { id: organizationId }, select: { requireShift: true } }))?.requireShift ?? false;
}

/** Opens the user's shift (one at a time on a branch) with the cash they start with. It is active at once: sales and cash can go through it. */
export async function openShift(input: Actor & { openingCash: string; cashAccountId?: string; denominations?: Record<string, number> }) {
  const openingCash = parseMoney(input.openingCash);
  if (!openingCash || openingCash.isNeg()) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter opening cash with up to two decimals." };
  }
  const requestHash = hashPayload({ openingCash: input.openingCash, cashAccountId: input.cashAccountId ?? null });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const open = await tx.shift.findFirst({ where: { organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, status: { not: "CLOSED" } }, select: { id: true } });
      if (open) {
        throw new StockRuleError("This user already has a shift open on this branch.");
      }
      const account = await moneyAccountFor(tx, input.organizationId, { method: "CASH", accountId: input.cashAccountId });
      const kind = await tx.account.findUniqueOrThrow({ where: { id: account }, select: { kind: true } });
      if (kind.kind !== "CASH") {
        throw new StockRuleError("A drawer is counted in a cash account.");
      }
      const shift = await tx.shift.create({
        data: { organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, status: "ACTIVE", openingCash, cashAccountId: account },
        select: { id: true },
      });
      await remember(tx, { ...input, requestHash, entityType: "shift", entityId: shift.id });
      return { id: shift.id, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "open", module: "shifts", entityType: "shift", entityId: data.id, ip: input.ip, userAgent: input.userAgent });
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

/**
 * Cash going into or out of the drawer that is not a sale (P08: cash in/out is a journal, not a note): Dr the drawer / Cr the other account
 * (cash in, from the bank, the owner's capital, other income), or Dr the other account (an expense, the bank) / Cr the drawer (cash out).
 */
export async function postCashMovement(input: Actor & { shiftId: string; direction: "IN" | "OUT"; amount: string; counterAccountId: string; reason?: string | null }) {
  const amountValue = parseMoney(input.amount);
  if (!amountValue || amountValue.lte(0)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a movement amount greater than zero." };
  }
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 255) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "The reason is too long." };
  }
  const requestHash = hashPayload({ shiftId: input.shiftId, direction: input.direction, amount: input.amount, counter: input.counterAccountId, reason });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const current = await lockShift(tx, input.organizationId, input.branchId, input.shiftId);
      if (current.status !== "ACTIVE") {
        throw new StockRuleError("Cash can move only while the shift is active.");
      }
      if (current.userId !== input.userId) {
        throw new StockRuleError("Only the shift's own cashier moves cash through it.");
      }
      if (!current.cashAccountId || current.cashAccountId === input.counterAccountId) {
        throw new StockRuleError("Choose the other account the cash comes from or goes to.");
      }
      const movement = await tx.cashMovement.create({ data: { organizationId: input.organizationId, shiftId: current.id, direction: input.direction, amount: amountValue, reason, userId: input.userId }, select: { id: true } });
      await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(today()),
        description: `Cash ${input.direction === "IN" ? "in" : "out"}${reason ? `: ${reason}` : ""}`,
        createdById: input.userId,
        doc: { type: "CASH_MOVEMENT", id: movement.id },
        lines:
          input.direction === "IN"
            ? [{ accountId: current.cashAccountId, debit: amountValue, credit: zero(), shiftId: current.id }, { accountId: input.counterAccountId, debit: zero(), credit: amountValue }]
            : [{ accountId: input.counterAccountId, debit: amountValue, credit: zero() }, { accountId: current.cashAccountId, debit: zero(), credit: amountValue, shiftId: current.id }],
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

/** What went through a shift's cash account(s), by kind of document, and what the drawer should hold now (opening + what those lines add up to). */
export async function drawerBreakdown(db: Prisma.TransactionClient | typeof prisma, organizationId: string, shiftId: string, openingCash: Prisma.Decimal | null) {
  const rows = await db.$queryRaw<Array<{ docType: string; debit: Prisma.Decimal | null; credit: Prisma.Decimal | null; lines: bigint }>>`
    SELECT j.docType AS docType, SUM(l.debit) AS debit, SUM(l.credit) AS credit, COUNT(*) AS \`lines\`
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN accounts a ON a.id = l.accountId AND a.kind = 'CASH'
    WHERE l.organizationId = ${organizationId} AND l.shiftId = ${shiftId}
    GROUP BY j.docType
    ORDER BY j.docType
  `;
  const by = rows.map((row) => ({ docType: row.docType, debit: new Prisma.Decimal(row.debit ?? 0), credit: new Prisma.Decimal(row.credit ?? 0), lines: Number(row.lines) }));
  const sum = (pick: (row: (typeof by)[number]) => Prisma.Decimal) => by.reduce((total, row) => total.plus(pick(row)), zero());
  const received = sum((row) => (row.docType === "CUSTOMER_PAYMENT" || row.docType === "CUSTOMER_ADVANCE" ? row.debit : zero()));
  const refunds = sum((row) => (row.docType === "SALE_RETURN" ? row.credit : zero()));
  const otherIn = sum((row) => (row.docType === "CUSTOMER_PAYMENT" || row.docType === "CUSTOMER_ADVANCE" ? zero() : row.debit));
  const otherOut = sum((row) => (row.docType === "SALE_RETURN" ? zero() : row.credit));
  const net = sum((row) => row.debit.minus(row.credit));
  return {
    byDocument: by,
    cashSales: money(received),
    refunds: money(refunds),
    cashIn: money(otherIn),
    cashOut: money(otherOut),
    expected: money(new Prisma.Decimal(openingCash ?? 0).plus(net)),
  };
}

function countedFrom(denominations: Record<string, number> | undefined) {
  if (!denominations) {
    return null;
  }
  let total = 0;
  const clean: Record<string, number> = {};
  for (const [value, count] of Object.entries(denominations)) {
    if (!DENOMINATIONS.includes(Number(value) as (typeof DENOMINATIONS)[number]) || !Number.isInteger(count) || count < 0 || count > 1_000_000) {
      throw new StockRuleError("Count whole notes and coins of 1000, 500, 200, 100, 50, 20, 10, 5, 2 or 1.");
    }
    if (count > 0) {
      clean[value] = count;
      total += Number(value) * count;
    }
  }
  return { total: new Prisma.Decimal(total), clean };
}

/** The cashier counts the drawer: what is in it is compared with what should be. The shift moves to CLOSING; nothing is posted until it is closed. */
export async function countShift(input: Actor & { shiftId: string; actualCash?: string; denominations?: Record<string, number> }) {
  const requestHash = hashPayload({ shiftId: input.shiftId, actualCash: input.actualCash ?? null, denominations: input.denominations ?? null });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const counted = countedFrom(input.denominations);
      const typed = input.actualCash === undefined ? null : parseMoney(input.actualCash);
      if (!counted && !typed) {
        throw new StockRuleError("Enter the actual cash with up to two decimals, or count the notes.");
      }
      const actualCash = counted ? counted.total : (typed as Prisma.Decimal);
      if (actualCash.isNeg()) {
        throw new StockRuleError("The actual cash cannot be negative.");
      }
      const current = await lockShift(tx, input.organizationId, input.branchId, input.shiftId);
      if (current.status !== "ACTIVE") {
        throw new StockRuleError("Count the drawer only while the shift is active.");
      }
      const totals = await drawerBreakdown(tx, input.organizationId, current.id, current.openingCash);
      const difference = money(actualCash.minus(totals.expected));
      await tx.shift.update({
        where: { id: current.id },
        data: { status: "CLOSING", cashSales: totals.cashSales, cashIn: totals.cashIn, cashOut: totals.cashOut, refunds: totals.refunds, expectedCash: totals.expected, actualCash: money(actualCash), difference, ...(counted ? { denominations: counted.clean } : {}) },
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

/** Closes a counted shift. What is short comes out of the books as Miscellaneous expense, what is over goes in as Other income (#39); the drawer then holds what it should. */
export async function closeShift(input: Actor & { shiftId: string }) {
  const requestHash = hashPayload({ shiftId: input.shiftId, action: "close" });
  try {
    const data = await runTx(async (tx) => {
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
      const row = await tx.shift.findUniqueOrThrow({ where: { id: current.id }, select: { difference: true, cashAccountId: true } });
      const difference = new Prisma.Decimal(row.difference ?? 0);
      let varianceJournalId: string | null = null;
      if (!difference.isZero() && row.cashAccountId) {
        const gap = difference.abs();
        varianceJournalId = await postBalancedJournal(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: occurredDate(today()),
          description: difference.isNeg() ? "Cash short at shift close" : "Cash over at shift close",
          createdById: input.userId,
          doc: { type: "SHIFT_VARIANCE", id: current.id },
          lines: difference.isNeg()
            ? [{ role: "MISC", debit: gap, credit: zero() }, { accountId: row.cashAccountId, debit: zero(), credit: gap, shiftId: current.id }]
            : [{ accountId: row.cashAccountId, debit: gap, credit: zero(), shiftId: current.id }, { role: "OTHER_INCOME", debit: zero(), credit: gap }],
        });
      }
      await tx.shift.update({ where: { id: current.id }, data: { status: "CLOSED", closedAt: new Date(), varianceJournalId } });
      await remember(tx, { ...input, requestHash, entityType: "shift_close", entityId: current.id });
      return { id: current.id, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "close", module: "shifts", entityType: "shift", entityId: data.id, ip: input.ip, userAgent: input.userAgent });
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

/**
 * The counted drawer is handed over to another user. When the cash goes to another cash account (the shop's main cash, a safe), that is a
 * contra (Dr that account / Cr the drawer) and leaves the drawer; into the same account it is only recorded.
 */
export async function handOverShift(input: Actor & { shiftId: string; toUserId: string; amount: string; toAccountId?: string }) {
  const amountValue = parseMoney(input.amount);
  if (!amountValue || amountValue.lte(0)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a handover amount greater than zero." };
  }
  const requestHash = hashPayload({ shiftId: input.shiftId, toUserId: input.toUserId, amount: input.amount, toAccountId: input.toAccountId ?? null });
  try {
    const data = await runTx(async (tx) => {
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
      const recipient = await tx.user.findFirst({ where: { id: input.toUserId, organizationId: input.organizationId, status: "ACTIVE" }, select: { id: true } });
      if (!recipient) {
        throw new StockRuleError("That record was not found.", 404);
      }
      const handover = await tx.cashHandover.create({ data: { organizationId: input.organizationId, shiftId: current.id, fromUserId: current.userId, toUserId: recipient.id, amount: amountValue }, select: { id: true } });
      if (input.toAccountId && input.toAccountId !== current.cashAccountId && current.cashAccountId) {
        const to = await moneyAccountFor(tx, input.organizationId, { method: "CASH", accountId: input.toAccountId });
        await postBalancedJournal(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: occurredDate(today()),
          description: "Drawer handed over",
          createdById: input.userId,
          doc: { type: "CONTRA", id: handover.id },
          lines: [{ accountId: to, debit: amountValue, credit: zero() }, { accountId: current.cashAccountId, debit: zero(), credit: amountValue, shiftId: current.id }],
        });
      }
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

export async function listShifts(organizationId: string, branchId: string) {
  const rows = await prisma.shift.findMany({ where: { organizationId, branchId }, orderBy: { openedAt: "desc" }, take: 100, select: shiftSelect });
  return rows.map(present);
}

const LABEL: Record<string, string> = {
  CUSTOMER_PAYMENT: "Taken from customers",
  CUSTOMER_ADVANCE: "Advances taken",
  SALE_RETURN: "Refunds",
  EXPENSE: "Expenses paid",
  SUPPLIER_PAYMENT: "Paid to vendors",
  SUPPLIER_ADVANCE: "Advances paid to vendors",
  CONTRA: "Moved to or from other accounts",
  CASH_MOVEMENT: "Cash in / out",
  SHIFT_VARIANCE: "Short / over at close",
  INCOME: "Other income",
  CAPITAL: "Capital and drawings",
  LOAN: "Loans",
  VOUCHER: "Vouchers",
};

export async function getShift(organizationId: string, branchId: string, id: string) {
  const row = await prisma.shift.findFirst({ where: { id, organizationId, branchId }, select: shiftSelect });
  if (!row) {
    return null;
  }
  const [movements, handovers, live] = await Promise.all([
    prisma.cashMovement.findMany({ where: { shiftId: row.id }, orderBy: { createdAt: "asc" }, select: { id: true, direction: true, amount: true, reason: true } }),
    prisma.cashHandover.findMany({ where: { shiftId: row.id }, orderBy: { createdAt: "asc" }, select: { id: true, amount: true, toUser: { select: { name: true } } } }),
    drawerBreakdown(prisma, organizationId, row.id, row.openingCash),
  ]);
  return {
    ...present(row),
    /** What the drawer should hold right now, from the journal (while the shift is open; after the count the stored figure is what was compared). */
    expectedNow: decimalString(live.expected, 2),
    byDocument: live.byDocument.map((entry) => ({ docType: entry.docType, label: LABEL[entry.docType] ?? entry.docType, in: decimalString(entry.debit, 2), out: decimalString(entry.credit, 2), lines: entry.lines })),
    movements: movements.map((movement) => ({ id: movement.id, direction: movement.direction, amount: decimalString(movement.amount, 2), reason: movement.reason })),
    handovers: handovers.map((handover) => ({ id: handover.id, amount: decimalString(handover.amount, 2), toName: handover.toUser.name })),
    day: dateOnly(row.openedAt),
  };
}

export async function listHandoverUsers(organizationId: string) {
  const rows = await prisma.user.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return rows;
}
