import { Prisma, type PartyType } from "@prisma/client";

import type { PartyRole } from "@/core/ledger/roles";
import { dateOnly, daysBetween, isIsoDate } from "@/core/time/business-date";

// The party sub-ledger (P02 task 5, invariant I8). What a customer owes, what the shop owes a vendor, what a courier holds:
// all of it is the sum of the journal lines that carry the party, read from journal_lines and nowhere else, so a balance can
// never disagree with the books. Every function takes the party's own lines through the (organization, party, date) index.

type Db = Prisma.TransactionClient;

/** MAIN is the receivable (customer, courier) or payable (vendor); ADVANCE is the money held for or paid to the party ahead. */
export type PartyAccount = "MAIN" | "ADVANCE";

type Side = { role: PartyRole; /** +1: balance = debit - credit (an asset); -1: credit - debit (a liability). */ sign: 1 | -1 };

// Which party account is which, and which way it counts.
const ACCOUNTS: Record<PartyType, Partial<Record<PartyAccount, Side>>> = {
  CUSTOMER: { MAIN: { role: "AR", sign: 1 }, ADVANCE: { role: "CUSTOMER_ADVANCE", sign: -1 } },
  VENDOR: { MAIN: { role: "AP", sign: -1 }, ADVANCE: { role: "VENDOR_ADVANCE", sign: 1 } },
  COURIER: { MAIN: { role: "COURIER_AR", sign: 1 } },
  EMPLOYEE: {},
};

const ZERO = new Prisma.Decimal(0);
const day = (iso: string) => {
  if (!isIsoDate(iso)) {
    throw new RangeError(`Not a date (YYYY-MM-DD): ${iso}`);
  }
  return new Date(`${iso}T00:00:00.000Z`);
};
const dec = (value: unknown) => new Prisma.Decimal(String(value ?? 0));

function sideOf(partyType: PartyType, account: PartyAccount): Side | null {
  return ACCOUNTS[partyType][account] ?? null;
}

type Raw = { partyId: string; role: string; debit: Prisma.Decimal | string | null; credit: Prisma.Decimal | string | null };

/** Balance and advance of each of the given parties, as of a day (default: everything posted). Every asked party has an entry. */
export async function partyBalances(
  db: Db,
  input: { organizationId: string; partyType: PartyType; partyIds: string[]; asOf?: string },
): Promise<Map<string, { balance: Prisma.Decimal; advance: Prisma.Decimal }>> {
  const result = new Map(input.partyIds.map((id) => [id, { balance: ZERO, advance: ZERO }]));
  if (input.partyIds.length === 0) {
    return result;
  }
  const roles = (["MAIN", "ADVANCE"] as const).flatMap((account) => {
    const side = sideOf(input.partyType, account);
    return side ? [side.role] : [];
  });
  if (roles.length === 0) {
    return result;
  }
  const asOf = input.asOf ? day(input.asOf) : null;
  const rows = await db.$queryRaw<Raw[]>`
    SELECT l.partyId AS partyId, r.role AS role, SUM(l.debit) AS debit, SUM(l.credit) AS credit
    FROM journal_lines l
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role IN (${Prisma.join(roles)})
    WHERE l.organizationId = ${input.organizationId}
      AND l.partyType = ${input.partyType}
      AND l.partyId IN (${Prisma.join(input.partyIds)})
      ${asOf ? Prisma.sql`AND l.businessDate <= ${asOf}` : Prisma.empty}
    GROUP BY l.partyId, r.role
  `;
  const main = sideOf(input.partyType, "MAIN");
  const advance = sideOf(input.partyType, "ADVANCE");
  for (const row of rows) {
    const entry = result.get(row.partyId);
    if (!entry) {
      continue;
    }
    const net = dec(row.debit).minus(dec(row.credit));
    if (main && row.role === main.role) {
      entry.balance = net.mul(main.sign);
    } else if (advance && row.role === advance.role) {
      entry.advance = net.mul(advance.sign);
    }
  }
  return result;
}

/**
 * One party's balance. MAIN (default): what a customer or courier owes the shop, what the shop owes a vendor. ADVANCE: the money
 * held for a customer (their wallet), or paid ahead to a vendor.
 */
export async function partyBalance(
  db: Db,
  input: { organizationId: string; partyType: PartyType; partyId: string; asOf?: string; account?: PartyAccount },
): Promise<Prisma.Decimal> {
  const all = await partyBalances(db, { organizationId: input.organizationId, partyType: input.partyType, partyIds: [input.partyId], asOf: input.asOf });
  const entry = all.get(input.partyId) ?? { balance: ZERO, advance: ZERO };
  return input.account === "ADVANCE" ? entry.advance : entry.balance;
}

export type StatementRow = {
  lineId: string;
  businessDate: string;
  /** The document number, or its description when it has none. */
  reference: string;
  docType: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** The party's balance after this line. */
  balance: Prisma.Decimal;
};

/** The party's account for a period: what stood at the start, each line in date order with the running balance, and the end. */
export async function partyStatement(
  db: Db,
  input: { organizationId: string; partyType: PartyType; partyId: string; from: string; to: string; account?: PartyAccount },
): Promise<{ opening: Prisma.Decimal; rows: StatementRow[]; closing: Prisma.Decimal }> {
  const side = sideOf(input.partyType, input.account ?? "MAIN");
  if (!side) {
    return { opening: ZERO, rows: [], closing: ZERO };
  }
  const from = day(input.from);
  const to = day(input.to);
  const where = { organizationId: input.organizationId, partyType: input.partyType, partyId: input.partyId, account: { roles: { some: { role: side.role } } } };
  const before = await db.journalLine.aggregate({ where: { ...where, businessDate: { lt: from } }, _sum: { debit: true, credit: true } });
  const opening = dec(before._sum.debit).minus(dec(before._sum.credit)).mul(side.sign);
  const lines = await db.journalLine.findMany({
    where: { ...where, businessDate: { gte: from, lte: to } },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, businessDate: true, debit: true, credit: true, journal: { select: { number: true, description: true, docType: true } } },
  });
  let running = opening;
  const rows = lines.map((line) => {
    running = running.plus(dec(line.debit).minus(dec(line.credit)).mul(side.sign));
    return {
      lineId: line.id,
      businessDate: dateOnly(line.businessDate),
      reference: line.journal.number ?? line.journal.description ?? "Journal",
      docType: line.journal.docType,
      debit: dec(line.debit),
      credit: dec(line.credit),
      balance: running,
    };
  });
  return { opening, rows, closing: running };
}

export type AgeBucket = { label: string; fromDays: number; toDays: number | null; amount: Prisma.Decimal };

const BUCKETS: { label: string; fromDays: number; toDays: number | null }[] = [
  { label: "0-30", fromDays: 0, toDays: 30 },
  { label: "31-60", fromDays: 31, toDays: 60 },
  { label: "61-90", fromDays: 61, toDays: 90 },
  { label: "90+", fromDays: 91, toDays: null },
];

/**
 * What is still owed, by how old it is. Receipts and payments are applied to the oldest charge first (first in, first out), so
 * what is left is the recent part; the buckets add up to the party's balance. A party who has paid more than was charged has
 * nothing outstanding and the surplus is reported as `unapplied`.
 */
export async function agingBuckets(
  db: Db,
  input: { organizationId: string; partyType: PartyType; partyId: string; asOf: string },
): Promise<{ buckets: AgeBucket[]; total: Prisma.Decimal; unapplied: Prisma.Decimal }> {
  const buckets = BUCKETS.map((bucket) => ({ ...bucket, amount: ZERO }));
  const side = sideOf(input.partyType, "MAIN");
  if (!side) {
    return { buckets, total: ZERO, unapplied: ZERO };
  }
  const asOf = day(input.asOf);
  const where = { organizationId: input.organizationId, partyType: input.partyType, partyId: input.partyId, businessDate: { lte: asOf }, account: { roles: { some: { role: side.role } } } };
  // A charge raises the balance (a debit for a receivable, a credit for a payable); a payment lowers it.
  const chargeColumn = side.sign === 1 ? "debit" : "credit";
  const payColumn = side.sign === 1 ? "credit" : "debit";
  const charges = await db.journalLine.findMany({
    where: { ...where, [chargeColumn]: { gt: 0 } },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { businessDate: true, debit: true, credit: true },
  });
  const paid = await db.journalLine.aggregate({ where, _sum: { [payColumn]: true } });
  let toApply = dec(paid._sum[payColumn]);
  let total = ZERO;
  for (const charge of charges) {
    let open = dec(charge[chargeColumn]);
    const used = Prisma.Decimal.min(open, toApply);
    open = open.minus(used);
    toApply = toApply.minus(used);
    if (open.gt(0)) {
      const age = daysBetween(dateOnly(charge.businessDate), input.asOf);
      const bucket = buckets.find((b) => age >= b.fromDays && (b.toDays === null || age <= b.toDays)) ?? buckets[0];
      bucket.amount = bucket.amount.plus(open);
      total = total.plus(open);
    }
  }
  return { buckets, total, unapplied: toApply };
}
