import { Prisma } from "@prisma/client";

import type { AccountRole } from "@/core/ledger/roles";
import { decimalString } from "@/core/money";
import { addDays } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";

// What every report is made of (P11 task 1, 05_REPORTS.md). A report reads only posted journal lines, stock ledgers and document headers; it
// runs over a date range (a "daily" report is one day) and the branches the user may see; and under it are its identities: sums that must agree
// with the ledger, each green or red with the difference. The dashboard asks the same functions (I16), so a card and its report never differ.

export type ReportCtx = {
  organizationId: string;
  /** The branches the report covers; null: every branch of the organization (needs reports.all_branches). */
  branchIds: string[] | null;
  from: string;
  to: string;
  /** May the user see cost, COGS and profit (reports.profit)? */
  canProfit: boolean;
};

export type Text = { en: string; bn: string };
export type Column = { key: string; label: Text; numeric?: boolean };
export type Row = Record<string, string | number | null>;
export type Section = { key: string; title: Text; columns: Column[]; rows: Row[]; total?: Row };
export type Identity = { label: Text; left: string; right: string; ok: boolean; difference: string };
export type ReportResult = { key: string; title: Text; from: string; to: string; summary: Array<{ label: Text; value: string }>; sections: Section[]; identities: Identity[] };

export const ZERO = new Prisma.Decimal(0);
export const dec = (value: Prisma.Decimal | string | number | bigint | null | undefined) => new Prisma.Decimal(value === null || value === undefined ? 0 : value.toString());
export const money = (value: Prisma.Decimal) => decimalString(value, 2);
export const t = (en: string, bn: string): Text => ({ en, bn });
export const col = (key: string, en: string, bn: string, numeric = false): Column => ({ key, label: t(en, bn), numeric });

/** One identity line: two sums that must be equal (to the poisha). */
export function identity(label: Text, left: Prisma.Decimal, right: Prisma.Decimal): Identity {
  const difference = left.minus(right);
  return { label, left: money(left), right: money(right), ok: difference.abs().lt(0.005), difference: money(difference) };
}

export function sumOf<T>(rows: T[], pick: (row: T) => Prisma.Decimal) {
  return rows.reduce((total, row) => total.plus(pick(row)), ZERO);
}

/** `AND l.branchId IN (...)` for a ledger line, or nothing for every branch. */
export function lineBranches(ctx: Pick<ReportCtx, "branchIds">, alias = "l") {
  if (ctx.branchIds === null) {
    return Prisma.empty;
  }
  if (ctx.branchIds.length === 0) {
    return Prisma.sql`AND 1 = 0`;
  }
  return Prisma.sql`AND ${Prisma.raw(alias)}.branchId IN (${Prisma.join(ctx.branchIds)})`;
}

/** The Prisma `where` for a document's branch. */
export function docBranches(ctx: Pick<ReportCtx, "branchIds">) {
  return ctx.branchIds === null ? {} : { branchId: { in: ctx.branchIds } };
}

export const day = (text: string) => new Date(`${text}T00:00:00.000Z`);

/** Debit and credit of every account in the window (or up to and including a day when `from` is null), posted journals only. */
export async function accountTotals(ctx: Pick<ReportCtx, "organizationId" | "branchIds">, from: string | null, to: string) {
  const rows = await prisma.$queryRaw<Array<{ accountId: string; debit: Prisma.Decimal | null; credit: Prisma.Decimal | null }>>`
    SELECT l.accountId AS accountId, SUM(l.debit) AS debit, SUM(l.credit) AS credit
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    WHERE l.organizationId = ${ctx.organizationId} ${lineBranches(ctx)}
      AND l.businessDate <= ${to} ${from ? Prisma.sql`AND l.businessDate >= ${from}` : Prisma.empty}
    GROUP BY l.accountId
  `;
  return new Map(rows.map((row) => [row.accountId, { debit: dec(row.debit), credit: dec(row.credit) }]));
}

/** The accounts with their role(s), kind and group, for the reports to sort lines by. */
export async function chart(organizationId: string) {
  const accounts = await prisma.account.findMany({
    where: { organizationId },
    select: { id: true, code: true, name: true, kind: true, group: { select: { code: true } }, roles: { select: { role: true } } },
    orderBy: { code: "asc" },
  });
  return accounts.map((account) => ({ id: account.id, code: account.code, name: account.name, kind: account.kind as string, group: account.group.code, roles: account.roles.map((row) => row.role as AccountRole) }));
}

export type ChartAccount = Awaited<ReturnType<typeof chart>>[number];

/** Debit minus credit of the accounts that play a role (or of the given accounts), from totals. */
export function netOf(totals: Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>, accounts: ChartAccount[], test: (account: ChartAccount) => boolean) {
  return accounts.filter(test).reduce((sum, account) => {
    const row = totals.get(account.id);
    return row ? sum.plus(row.debit).minus(row.credit) : sum;
  }, ZERO);
}

export const hasRole = (role: AccountRole) => (account: ChartAccount) => account.roles.includes(role);
export const isMoney = (account: ChartAccount) => account.kind === "CASH" || account.kind === "BANK" || account.kind === "MOBILE";

/** The day before a date (YYYY-MM-DD). */
export const dayBefore = (text: string) => addDays(text, -1);
