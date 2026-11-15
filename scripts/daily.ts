// P11 task 5-6. The day's close for every shop of the database DATABASE_URL points at: makes the snapshots that are due (every day up to yesterday, and
// any marked stale), then checks the books: the books check, every report's identities and the stored snapshots against the ledger. Run it from cron at
// 00:10 Dhaka time. It also runs at the first sign-in after midnight (the dashboard), so a missed run costs nothing.
//
//   node --experimental-strip-types --import ./src/test/register.mjs scripts/daily.ts
//
// Exit code 0: everything agrees. 1: something does not (it says what, and since when). Reads and writes snapshots only; never on a live site by hand.
import { prisma } from "../src/lib/db/client.ts";
import { reconciliation } from "../src/modules/reports/reconcile.ts";
import { ensureSnapshots } from "../src/modules/reports/snapshots.ts";

if ((process.env.APP_URL ?? "").startsWith("https://") && process.env.ALLOW_LIVE_DAILY !== "1") {
  console.error("Refusing to run by hand against an https site. The server's cron sets ALLOW_LIVE_DAILY=1.");
  process.exit(2);
}

let failed = 0;
for (const org of await prisma.organization.findMany({ select: { id: true, slug: true }, orderBy: { slug: "asc" } })) {
  const { made } = await ensureSnapshots(org.id);
  const result = await reconciliation(org.id);
  console.log(`${org.slug}: ${made} snapshot(s) made, ${result.red} check(s) red${result.books.warnings.length > 0 ? `, ${result.books.warnings.length} warning(s)` : ""}`);
  for (const finding of result.books.findings) {
    console.log(`  FAIL ${finding.invariant} ${finding.subject}: ${finding.message}`);
  }
  for (const row of result.reports) {
    for (const check of row.checks.filter((item) => !item.ok)) {
      console.log(`  FAIL ${row.key}: ${check.label.en}: ${check.left} vs ${check.right} (difference ${check.difference})`);
    }
  }
  for (const row of result.snapshots.differences) {
    console.log(`  FAIL snapshot ${row.branch} ${row.date} ${row.field}: stored ${row.stored}, the ledger now ${row.now}`);
  }
  failed += result.red;
}
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
