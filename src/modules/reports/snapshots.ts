import { Prisma } from "@prisma/client";

import { addDays, businessDate, dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { dec, day, money } from "@/modules/reports/kit";

// Daily snapshots (P11 task 5): the books of each branch at the end of a day. A day is snapshotted once it is over (by the daily job, or at the first
// sign-in after it); a posting dated back into a day marks it and every later day stale (the posting engine does that), and they are made again.
// A snapshot is a figure read from the ledger, so it can always be made again; the reconciliation page compares the stored ones with the ledger.

export type Figures = { cash: Prisma.Decimal; bank: Prisma.Decimal; stockValue: Prisma.Decimal; receivable: Prisma.Decimal; payable: Prisma.Decimal; courierOwes: Prisma.Decimal };
export const FIELDS = ["cash", "bank", "stockValue", "receivable", "payable", "courierOwes"] as const;

/** One branch's books at the end of `date`, from the ledger. */
export async function figuresAt(organizationId: string, branchId: string, date: string): Promise<Figures> {
  const [kinds, roles, stock] = await Promise.all([
    prisma.$queryRaw<Array<{ kind: string; net: Prisma.Decimal | null }>>`
      SELECT a.kind AS kind, SUM(l.debit - l.credit) AS net
      FROM journal_lines l
      JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
      JOIN accounts a ON a.id = l.accountId AND a.kind IN ('CASH', 'BANK', 'MOBILE')
      WHERE l.organizationId = ${organizationId} AND l.branchId = ${branchId} AND l.businessDate <= ${date}
      GROUP BY a.kind
    `,
    prisma.$queryRaw<Array<{ role: string; net: Prisma.Decimal | null }>>`
      SELECT r.role AS role, SUM(l.debit - l.credit) AS net
      FROM journal_lines l
      JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
      JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role IN ('AR', 'AP', 'COURIER_AR')
      WHERE l.organizationId = ${organizationId} AND l.branchId = ${branchId} AND l.businessDate <= ${date}
      GROUP BY r.role
    `,
    prisma.$queryRaw<Array<{ value: Prisma.Decimal | null }>>`
      SELECT SUM(CASE WHEN s.direction = 'IN' THEN 1 ELSE -1 END * COALESCE(s.totalCost, ROUND(s.quantity * s.unitCost, 2), 0)) AS value
      FROM stock_ledgers s
      WHERE s.organizationId = ${organizationId} AND s.branchId = ${branchId} AND s.businessDate <= ${date}
    `,
  ]);
  const kind = (name: string) => dec(kinds.find((row) => row.kind === name)?.net);
  const role = (name: string) => dec(roles.find((row) => row.role === name)?.net);
  return { cash: kind("CASH"), bank: kind("BANK").plus(kind("MOBILE")), stockValue: dec(stock[0]?.value), receivable: role("AR"), payable: role("AP").neg(), courierOwes: role("COURIER_AR") };
}

async function save(organizationId: string, branchId: string, date: string) {
  const figures = await figuresAt(organizationId, branchId, date);
  const data = { ...figures, stale: false };
  await prisma.dailySnapshot.upsert({ where: { organizationId_branchId_businessDate: { organizationId, branchId, businessDate: day(date) } }, create: { organizationId, branchId, businessDate: day(date), ...data }, update: data });
}

/** How many days back a first run goes (a snapshot is a quick read; older days are still in the ledger). */
const BACK = 62;

/**
 * Makes the snapshots that are due: every day up to yesterday that has none, and every one marked stale. Safe to call at any time and from two places at
 * once (the snapshot of a day is one row; making it twice gives the same figures).
 */
export async function ensureSnapshots(organizationId: string, now: Date = new Date()) {
  const yesterday = addDays(businessDate(now), -1);
  const branches = await prisma.branch.findMany({ where: { organizationId }, select: { id: true } });
  let made = 0;
  for (const branch of branches) {
    const [latest, first, stale] = await Promise.all([
      prisma.dailySnapshot.findFirst({ where: { organizationId, branchId: branch.id }, orderBy: { businessDate: "desc" }, select: { businessDate: true } }),
      prisma.journalLine.findFirst({ where: { organizationId, branchId: branch.id }, orderBy: { businessDate: "asc" }, select: { businessDate: true } }),
      prisma.dailySnapshot.findMany({ where: { organizationId, branchId: branch.id, stale: true }, select: { businessDate: true } }),
    ]);
    if (!first) {
      continue;
    }
    const earliest = addDays(yesterday, -(BACK - 1));
    const firstDay = dateOnly(first.businessDate);
    let from = latest ? addDays(dateOnly(latest.businessDate), 1) : firstDay > earliest ? firstDay : earliest;
    if (from < firstDay) {
      from = firstDay;
    }
    const dates = new Set<string>(stale.map((row) => dateOnly(row.businessDate)));
    for (let date = from; date <= yesterday; date = addDays(date, 1)) {
      dates.add(date);
    }
    for (const date of [...dates].sort()) {
      if (date <= yesterday) {
        await save(organizationId, branch.id, date);
        made += 1;
      }
    }
  }
  return { made };
}

export type SnapshotDifference = { branch: string; date: string; field: (typeof FIELDS)[number]; stored: string; now: string };

/**
 * Compares the stored snapshots (the last `days` days) with the ledger now. A day that differs and is not marked stale means something changed that
 * day without the posting engine noticing; the earliest such day is where to start looking ("since when").
 */
export async function snapshotDifferences(organizationId: string, days = 14, now: Date = new Date()) {
  const from = addDays(businessDate(now), -days);
  const rows = await prisma.dailySnapshot.findMany({ where: { organizationId, stale: false, businessDate: { gte: day(from) } }, orderBy: { businessDate: "asc" }, include: { branch: { select: { name: true } } } });
  const differences: SnapshotDifference[] = [];
  for (const row of rows) {
    const date = dateOnly(row.businessDate);
    const nowFigures = await figuresAt(organizationId, row.branchId, date);
    for (const field of FIELDS) {
      if (!dec(row[field]).minus(nowFigures[field]).abs().lt(0.005)) {
        differences.push({ branch: row.branch.name, date, field, stored: money(dec(row[field])), now: money(nowFigures[field]) });
      }
    }
  }
  return { checked: rows.length, differences };
}

