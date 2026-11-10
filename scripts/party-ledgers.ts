// P02 task 6. Compares every customer's and vendor's balance in the old ledger tables with the journal, and repairs a database
// written before parties were recorded on journal lines.
//
//   node --experimental-strip-types --import ./src/test/register.mjs scripts/party-ledgers.ts check
//   node --experimental-strip-types --import ./src/test/register.mjs scripts/party-ledgers.ts repair
//
// It works on the database DATABASE_URL points at, and never on a live one: it refuses an https APP_URL. `repair` writes only
// the missing party and document labels and one visible journal per customer whose advance sat on the receivable.
import { comparePartyLedgers, repairLegacyParties } from "../src/core/parties/legacy.ts";
import { partyLineViolations } from "../src/core/posting/invariants.ts";
import { runTx } from "../src/core/tx/run.ts";
import { prisma } from "../src/lib/db/client.ts";

const mode = process.argv[2];
if (mode !== "check" && mode !== "repair") {
  console.error("usage: party-ledgers.ts check | repair");
  process.exit(2);
}
if ((process.env.APP_URL ?? "").startsWith("https://")) {
  console.error("Refusing to run: APP_URL is https, this looks like a live site.");
  process.exit(2);
}

async function report(label: string, organizationId: string) {
  const result = await runTx((tx) => comparePartyLedgers(tx, organizationId));
  const violations = await runTx((tx) => partyLineViolations(tx, organizationId));
  console.log(`  ${label}: customers checked ${result.checked.customers}, vendors checked ${result.checked.suppliers}, out of line: ${result.customers.length + result.suppliers.length}, receivable/payable lines without a party: ${violations.length}`);
  for (const row of [...result.customers, ...result.suppliers]) {
    console.log(`    ${row.partyType.padEnd(8)} ${row.name.slice(0, 28).padEnd(28)} old ledger ${row.oldNet.padStart(12)} | journal ${row.journalBalance.padStart(12)} (advance ${row.journalAdvance}) | difference ${row.difference}`);
  }
  return result.customers.length + result.suppliers.length;
}

let outOfLine = 0;
const organizations = await prisma.organization.findMany({ select: { id: true, slug: true }, orderBy: { slug: "asc" } });
for (const org of organizations) {
  console.log(`${org.slug}`);
  if (mode === "repair") {
    const branch = await prisma.branch.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    const user = await prisma.user.findFirst({ where: { organizationId: org.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!branch || !user) {
      console.log("  skipped: no branch or no active user to post the repair with");
      continue;
    }
    await report("before", org.id);
    const done = await runTx((tx) => repairLegacyParties(tx, { organizationId: org.id, userId: user.id, branchId: branch.id }));
    console.log(`  repaired: ${done.linesStamped} line(s) given their party, ${done.journalsDocumented} journal(s) given their document, ${done.advancesMoved} advance(s) moved to Customer Advance, ${done.allocationsReplayed} receipt(s)/payment(s) given their invoice allocations`);
    outOfLine += await report("after ", org.id);
  } else {
    outOfLine += await report("check ", org.id);
  }
}
await prisma.$disconnect();
console.log(outOfLine === 0 ? "ALL BALANCES AGREE" : `${outOfLine} PARTY BALANCE(S) OUT OF LINE`);
process.exit(outOfLine === 0 ? 0 : 1);
