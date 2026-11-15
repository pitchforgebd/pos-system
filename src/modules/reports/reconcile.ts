import { businessDate } from "@/core/time/business-date";
import { reconcileBooks, type Finding } from "@/core/reconcile";
import { prisma } from "@/lib/db/client";
import type { Identity, Text } from "@/modules/reports/kit";
import { allReports } from "@/modules/reports/registry";
import { snapshotDifferences, type SnapshotDifference } from "@/modules/reports/snapshots";

// The reconciliation page and the daily job (P11 task 6): every identity of the books in one place, green or red, with the difference and since when.
// (1) the books check (I1, I2, I4, I7, I8, I15, I16, I19 ...); (2) the identity lines of every report, run over the whole company for the day;
// (3) the stored daily snapshots against the ledger now. The dashboard shows a red banner when any of them is red.

export type Reconciliation = {
  date: string;
  books: { findings: Finding[]; warnings: Finding[] };
  reports: Array<{ key: string; title: Text; checks: Identity[] }>;
  snapshots: { checked: number; differences: SnapshotDifference[] };
  red: number;
  ok: boolean;
};

export async function reconciliation(organizationId: string, date: string = businessDate()): Promise<Reconciliation> {
  const [books, snapshots] = await Promise.all([reconcileBooks(prisma, organizationId), snapshotDifferences(organizationId)]);
  const ctx = { organizationId, branchIds: null, from: date, to: date, canProfit: true };
  const reports: Reconciliation["reports"] = [];
  const run = async (report: ReturnType<typeof allReports>[number]) => {
    try {
      const result = await report.run(ctx);
      return result.identities.length > 0 ? { key: result.key, title: result.title, checks: result.identities } : null;
    } catch (error) {
      return { key: report.key, title: report.title, checks: [{ label: { en: `The report did not run: ${error instanceof Error ? error.message : "error"}`, bn: "রিপোর্ট চলেনি" }, left: "", right: "", ok: false, difference: "" }] };
    }
  };
  // four at a time: quick, and well inside the connection pool
  const all = allReports();
  for (let at = 0; at < all.length; at += 4) {
    for (const row of await Promise.all(all.slice(at, at + 4).map(run))) {
      if (row) {
        reports.push(row);
      }
    }
  }
  const red = books.findings.length + reports.reduce((sum, row) => sum + row.checks.filter((check) => !check.ok).length, 0) + snapshots.differences.length;
  return { date, books, reports, snapshots, red, ok: red === 0 };
}
