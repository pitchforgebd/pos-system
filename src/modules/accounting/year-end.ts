import { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { hashPayload } from "@/core/idempotency";
import { GROUP } from "@/core/ledger/groups";
import { decimalString, zero } from "@/core/money";
import { businessDate as today, dateOnly, fiscalYear } from "@/core/time/business-date";
import { runTx } from "@/core/tx/run";
import { prisma } from "@/lib/db/client";
import { occurredDate } from "@/lib/format/date";
import { postBalancedJournal, type JournalLineInput } from "@/modules/accounting/post";
import { writeAudit } from "@/modules/auth/audit";
import { failure, type Actor } from "@/modules/purchasing/common";
import { remember, replay } from "@/modules/treasury/common";

// Closing a fiscal year (P11 task 8): every income, cost and expense account of the year is brought to zero by one YEAR_CLOSE journal dated the last day
// of the year, and what is left (the year's profit or loss) goes to Retained Earnings, branch by branch. Then the period is locked up to that day
// (I11): nothing can be posted into the year again. It is the owner's decision, so it needs the permission and the year's name typed in. The profit
// and expense reports leave the closing journal out, so a closed year still shows its profit.

const text = (value: Prisma.Decimal) => decimalString(value, 2);

type YearRow = { startYear: number; label: string; start: string; end: string; status: "OPEN" | "CURRENT" | "CLOSED"; profit: string; closable: boolean };

async function startMonth(organizationId: string) {
  return (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { fiscalYearStartMonth: true } })).fiscalYearStartMonth;
}

const yearOf = (start: number, month: number) => fiscalYear(`${String(start).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`, month);

/** What each P&L account (and branch) of the year adds up to, the year's own journals only (no closing). Debit minus credit. */
async function yearNets(db: Prisma.TransactionClient | typeof prisma, organizationId: string, from: string, to: string) {
  return db.$queryRaw<Array<{ accountId: string; branchId: string | null; net: Prisma.Decimal | null }>>`
    SELECT l.accountId AS accountId, l.branchId AS branchId, SUM(l.debit - l.credit) AS net
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED' AND (j.docType IS NULL OR j.docType <> 'YEAR_CLOSE')
    JOIN accounts a ON a.id = l.accountId
    JOIN account_groups g ON g.id = a.groupId AND g.code IN (${GROUP.REVENUE}, ${GROUP.COST_OF_SALES}, ${GROUP.EXPENSE})
    WHERE l.organizationId = ${organizationId} AND l.businessDate BETWEEN ${from} AND ${to}
    GROUP BY l.accountId, l.branchId
    HAVING SUM(l.debit - l.credit) <> 0
  `;
}

/** The fiscal years from the first posting to the current one, with whether each is closed and what it earned. */
export async function listYears(organizationId: string): Promise<YearRow[]> {
  const month = await startMonth(organizationId);
  const [org, first] = await Promise.all([prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { lockedThrough: true } }), prisma.journalLine.findFirst({ where: { organizationId }, orderBy: { businessDate: "asc" }, select: { businessDate: true } })]);
  const now = today();
  const current = fiscalYear(now, month);
  const firstStart = first ? fiscalYear(dateOnly(first.businessDate), month).startYear : current.startYear;
  const locked = org.lockedThrough ? dateOnly(org.lockedThrough) : null;
  const years: YearRow[] = [];
  for (let start = current.startYear; start >= firstStart; start -= 1) {
    const year = yearOf(start, month);
    const nets = await yearNets(prisma, organizationId, year.start, year.end);
    const profit = nets.reduce((sum, row) => sum.minus(new Prisma.Decimal(row.net ?? 0)), zero());
    const closed = (await prisma.journal.count({ where: { organizationId, docType: "YEAR_CLOSE", businessDate: new Date(`${year.end}T00:00:00.000Z`), status: "POSTED" } })) > 0;
    const over = year.end < now;
    years.push({ startYear: start, label: `${year.startYear}-${String(year.endYear).slice(2)}`, start: year.start, end: year.end, status: closed ? "CLOSED" : over ? "OPEN" : "CURRENT", profit: text(profit), closable: over && !closed && !(locked && locked >= year.end) });
  }
  return years;
}

/**
 * Closes the fiscal year that starts in `startYear`. The year must be over, not closed, and the years before it that have postings must be closed
 * first. `confirm` is the year's label as typed by the owner.
 */
export async function closeYear(input: Actor & { startYear: number; confirm: string }) {
  const requestHash = hashPayload({ close: input.startYear, confirm: input.confirm });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, profit: "0.00", lines: 0, replayed: true };
      }
      // one close at a time for the shop
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${input.organizationId} FOR UPDATE`;
      const org = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId }, select: { fiscalYearStartMonth: true, lockedThrough: true } });
      const year = yearOf(input.startYear, org.fiscalYearStartMonth);
      const label = `${year.startYear}-${String(year.endYear).slice(2)}`;
      if (input.confirm.trim() !== label) {
        throw new RuleError(`Type the year (${label}) to confirm closing it.`);
      }
      if (year.end >= today()) {
        throw new RuleError("A year that is not over cannot be closed.");
      }
      const locked = org.lockedThrough ? dateOnly(org.lockedThrough) : null;
      if ((await tx.journal.count({ where: { organizationId: input.organizationId, docType: "YEAR_CLOSE", businessDate: occurredDate(year.end), status: "POSTED" } })) > 0 || (locked && locked >= year.end)) {
        throw new RuleError(`${label} is already closed.`, 409);
      }
      const earlier = await tx.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n
        FROM journal_lines l
        JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED' AND (j.docType IS NULL OR j.docType <> 'YEAR_CLOSE')
        JOIN accounts a ON a.id = l.accountId
        JOIN account_groups g ON g.id = a.groupId AND g.code IN (${GROUP.REVENUE}, ${GROUP.COST_OF_SALES}, ${GROUP.EXPENSE})
        WHERE l.organizationId = ${input.organizationId} AND l.businessDate < ${year.start}
          AND NOT EXISTS (SELECT 1 FROM journals c WHERE c.organizationId = l.organizationId AND c.docType = 'YEAR_CLOSE' AND c.status = 'POSTED' AND c.businessDate >= l.businessDate AND c.businessDate < ${year.start})
      `;
      if (Number(earlier[0]?.n ?? 0) > 0) {
        throw new RuleError("An earlier year still has postings that are not closed: close the earlier years first.", 409);
      }
      const nets = await yearNets(tx, input.organizationId, year.start, year.end);
      if (nets.length === 0) {
        throw new RuleError(`${label} has no income or expense to close.`);
      }
      const retained = (await tx.accountRole.findFirstOrThrow({ where: { organizationId: input.organizationId, role: "RETAINED" }, select: { accountId: true } })).accountId;
      const branches = [...new Set(nets.map((row) => row.branchId ?? input.branchId))];
      const lines: JournalLineInput[] = [];
      let profit = zero();
      for (const branchId of branches) {
        let branchNet = zero();
        for (const row of nets.filter((entry) => (entry.branchId ?? input.branchId) === branchId)) {
          const net = new Prisma.Decimal(row.net ?? 0);
          // the account is brought to zero: a debit balance is credited, a credit balance is debited
          lines.push({ accountId: row.accountId, debit: net.isNeg() ? net.neg() : zero(), credit: net.isNeg() ? zero() : net, branchId, memo: `Close ${label}` });
          branchNet = branchNet.plus(net);
        }
        // what is left goes to Retained Earnings: a profit (credit balances in the P&L) is credited there
        if (!branchNet.isZero()) {
          lines.push({ accountId: retained, debit: branchNet.isNeg() ? zero() : branchNet, credit: branchNet.isNeg() ? branchNet.neg() : zero(), branchId, memo: `Profit of ${label}` });
        }
        profit = profit.minus(branchNet);
      }
      const id = (await import("node:crypto")).randomUUID();
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(year.end),
        description: `Closing of the year ${label}`,
        createdById: input.userId,
        doc: { type: "YEAR_CLOSE", id },
        lines,
      });
      await tx.organization.update({ where: { id: input.organizationId }, data: { lockedThrough: occurredDate(year.end) } });
      await remember(tx, { ...input, requestHash, entityType: "year_close", entityId: journalId });
      return { id: journalId, profit: text(profit), lines: lines.length, replayed: false, label, end: year.end };
    });
    if (!data.replayed) {
      await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "year close", module: "accounting", entityType: "journal", entityId: data.id, after: { year: data.label, lockedThrough: data.end, profit: data.profit }, ip: input.ip, userAgent: input.userAgent });
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
