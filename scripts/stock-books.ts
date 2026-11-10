// P03 task 12. Brings the inventory account of an older database to the stock it holds (see core/stock/legacy.ts).
//
//   node --experimental-strip-types --import ./src/test/register.mjs scripts/stock-books.ts check
//   node --experimental-strip-types --import ./src/test/register.mjs scripts/stock-books.ts repair
//
// It works on the database DATABASE_URL points at, never on a live one (it refuses an https APP_URL). `check` only reads;
// `repair` writes one visible "v2 opening adjustment" journal per branch that needs it, and prices unpriced stock at the product's
// purchase price. A new, empty database (D16) needs neither.
import { adjustLegacyStockBooks } from "../src/core/stock/legacy.ts";
import { reconcileBooks } from "../src/core/reconcile/index.ts";
import { runTx } from "../src/core/tx/run.ts";
import { prisma } from "../src/lib/db/client.ts";

const mode = process.argv[2];
if (mode !== "check" && mode !== "repair") {
  console.error("usage: stock-books.ts check | repair");
  process.exit(2);
}
if ((process.env.APP_URL ?? "").startsWith("https://")) {
  console.error("Refusing to run: APP_URL is https, this looks like a live site.");
  process.exit(2);
}

async function show(label: string, organizationId: string) {
  const { findings, warnings } = await reconcileBooks(prisma, organizationId);
  console.log(`  ${label}: ${findings.length} finding(s), ${warnings.length} inventory warning(s)`);
  for (const row of [...findings, ...warnings]) {
    console.log(`    ${row.invariant} ${row.subject}: ${row.message}`);
  }
  return findings.length + warnings.length;
}

let open = 0;
const organizations = await prisma.organization.findMany({ select: { id: true, slug: true }, orderBy: { slug: "asc" } });
for (const org of organizations) {
  console.log(org.slug);
  if (mode === "repair") {
    const user = await prisma.user.findFirst({ where: { organizationId: org.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!user) {
      console.log("  skipped: no active user to post with");
      continue;
    }
    await show("before", org.id);
    const done = await runTx((tx) => adjustLegacyStockBooks(tx, { organizationId: org.id, userId: user.id }));
    console.log(`  repaired: ${done.branches} branch(es) adjusted, ${done.priced} stock row(s) priced at the purchase price`);
    open += await show("after ", org.id);
  } else {
    open += await show("check ", org.id);
  }
}
await prisma.$disconnect();
console.log(open === 0 ? "INVENTORY ACCOUNT AGREES WITH THE STOCK" : `${open} ITEM(S) OPEN`);
process.exit(open === 0 ? 0 : 1);
