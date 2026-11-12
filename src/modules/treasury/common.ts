import type { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { readIdempotency, saveIdempotency } from "@/core/idempotency";
import { MONEY_KINDS } from "@/core/ledger/accounts";
import { zero } from "@/core/money";
import { daysInMonth, isIsoDate } from "@/lib/format/date";
import { chargeRole, type ChargeKind } from "@/modules/treasury/charges";
import type { Actor } from "@/modules/purchasing/common";

// What the treasury documents (expenses, contra transfers) share: the idempotency key, the money account a payment goes through, the charge line,
// and the month an expense belongs to.

export async function replay(tx: Prisma.TransactionClient, input: Actor & { requestHash: string }) {
  const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash: input.requestHash });
  if (existing === "mismatch") {
    throw new RuleError("This idempotency key was already used for a different request.", 409);
  }
  return existing;
}

export async function remember(tx: Prisma.TransactionClient, input: Actor & { requestHash: string; entityType: string; entityId: string }) {
  await saveIdempotency(tx, { organizationId: input.organizationId, userId: input.userId, key: input.idempotencyKey, requestHash: input.requestHash, entityType: input.entityType, entityId: input.entityId });
}

export type MoneyAccount = { id: string; kind: ChargeKind; code: string; name: string };

/** An active cash, bank or mobile account of this organization. */
export async function moneyAccountOf(db: Prisma.TransactionClient, organizationId: string, accountId: string): Promise<MoneyAccount> {
  const account = await db.account.findFirst({ where: { id: accountId, organizationId, status: "ACTIVE", kind: { in: [...MONEY_KINDS] } }, select: { id: true, kind: true, code: true, name: true } });
  if (!account) {
    throw new RuleError("That cash or bank account is not active.", 422);
  }
  return { id: account.id, kind: account.kind as ChargeKind, code: account.code, name: account.name };
}

/** The charge a bank or mobile service took on money that left it: only such an account has one, and it cannot be more than a payment's worth. */
export function checkCharge(kind: ChargeKind, charge: Prisma.Decimal) {
  if (charge.isNeg()) {
    throw new RuleError("A charge cannot be negative.");
  }
  if (charge.gt(0) && kind === "CASH") {
    throw new RuleError("A cash payment has no bank or mobile charge.");
  }
}

/** The line that puts the charge in the books (6600 for a bank, 6610 for a mobile account); none when there is no charge. */
export function chargeLines(kind: ChargeKind, charge: Prisma.Decimal) {
  return charge.gt(0) ? [{ role: chargeRole(kind), debit: charge, credit: zero() }] : [];
}

/** YYYY-MM of a calendar date. */
export const monthOf = (date: string) => date.slice(0, 7);

export function checkMonth(text: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw new RuleError("Choose a month (YYYY-MM).");
  }
  return text;
}

export function checkDate(text: string) {
  if (!isIsoDate(text)) {
    throw new RuleError("Choose a calendar date (YYYY-MM-DD).");
  }
  return text;
}

/** The date in `month` (YYYY-MM) with this day of the month, held to the last day of a short month. */
export function dateInMonth(month: string, day: number) {
  const [year, number] = month.split("-").map(Number);
  const last = daysInMonth(year, number);
  return `${month}-${String(Math.min(Math.max(day, 1), last)).padStart(2, "0")}`;
}

export const lastDayOfMonth = (month: string) => dateInMonth(month, 31);
