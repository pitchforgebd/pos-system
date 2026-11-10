// P02 task 10. Runs the books check (assertBooksReconcile's findings) over every organization in the database DATABASE_URL points at,
// and prints the owner's capital, so a database can be looked at without a test. Reads only; never on a live site.
//
//   node --experimental-strip-types --import ./src/test/register.mjs scripts/reconcile.ts
//
// Exit code 0: every organization reconciles (warnings, such as the inventory account against stock, are printed but do not fail).
import { reconcileBooks } from "../src/core/reconcile/index.ts";
import { prisma } from "../src/lib/db/client.ts";

if ((process.env.APP_URL ?? "").startsWith("https://")) {
  console.error("Refusing to run: APP_URL is https, this looks like a live site.");
  process.exit(2);
}

let failed = 0;
const organizations = await prisma.organization.findMany({ select: { id: true, slug: true }, orderBy: { slug: "asc" } });
for (const org of organizations) {
  const { findings, warnings } = await reconcileBooks(prisma, org.id);
  const capital = await prisma.$queryRaw<Array<{ net: string | number | null }>>`
    SELECT SUM(l.credit - l.debit) AS net
    FROM journal_lines l
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'CAPITAL'
    WHERE l.organizationId = ${org.id}
  `;
  const owner = Number(capital[0]?.net ?? 0);
  console.log(`${org.slug}: ${findings.length} finding(s), ${warnings.length} warning(s), owner capital ${owner.toFixed(2)}${owner < 0 ? "  <-- NEGATIVE" : ""}`);
  for (const row of findings) {
    console.log(`  FAIL ${row.invariant} ${row.subject}: ${row.message}`);
  }
  for (const row of warnings) {
    console.log(`  warn ${row.invariant} ${row.subject}: ${row.message}`);
  }
  failed += findings.length;
}
await prisma.$disconnect();
console.log(failed === 0 ? "ALL BOOKS RECONCILE" : `${failed} FINDING(S)`);
process.exit(failed === 0 ? 0 : 1);
