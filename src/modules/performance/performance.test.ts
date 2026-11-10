import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

type ExplainTable = { key?: string; possible_keys?: string[]; using_filesort?: boolean };

function findTable(node: unknown): ExplainTable | null {
  if (!node || typeof node !== "object") {
    return null;
  }
  if ("table_name" in node && "key" in node) {
    return node as ExplainTable;
  }
  for (const value of Object.values(node)) {
    const found = findTable(value);
    if (found) {
      return found;
    }
  }
  return null;
}

function explained(plan: unknown) {
  const table = findTable(plan);
  return { key: table?.key ?? "", possible: table?.possible_keys ?? [] };
}

test("phase 17 lists dues in one pass and the new indexes cover the explained filters", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { listCustomers } = await import("../customers/customers.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Fast A", slug: `fast-${stamp}` } });
  const owed = await prisma.customer.create({ data: { organizationId: org.id, name: "Ada" } });
  const clear = await prisma.customer.create({ data: { organizationId: org.id, name: "Bea" } });
  // A customer's balance comes from the journal lines that name them: owes 8.00, paid 3.00.
  const { Prisma } = await import("@prisma/client");
  const { post } = await import("../../core/posting/journal.ts");
  const { runTx } = await import("../../core/tx/run.ts");
  const { ensureChart } = await import("../../core/ledger/chart.ts");
  await ensureChart(prisma, org.id);
  await prisma.organization.update({ where: { id: org.id }, data: { backdateDays: 100000 } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const poster = await prisma.user.create({ data: { organizationId: org.id, name: "Poster", email: `poster-${stamp}@example.test`, passwordHash: "x" } });
  const party = { type: "CUSTOMER" as const, id: owed.id };
  const day = new Date("2026-10-01T00:00:00.000Z");
  const dec = (value: string) => new Prisma.Decimal(value);
  const base = { organizationId: org.id, branchId: branch.id, businessDate: day, createdById: poster.id };
  await runTx((tx) => post(tx, { ...base, description: "opening", doc: { type: "JOURNAL", id: crypto.randomUUID() }, lines: [{ role: "AR", debit: dec("8.00"), credit: dec("0"), party }, { role: "OPENING_EQUITY", debit: dec("0"), credit: dec("8.00") }] }));
  await runTx((tx) => post(tx, { ...base, description: "payment", doc: { type: "JOURNAL", id: crypto.randomUUID() }, lines: [{ role: "CASH", debit: dec("3.00"), credit: dec("0") }, { role: "AR", debit: dec("0"), credit: dec("3.00"), party }] }));

  try {
    const listed = await listCustomers(org.id);
    assert.equal(listed.find((row) => row.id === owed.id)?.outstanding, "5.00");
    assert.equal(listed.find((row) => row.id === clear.id)?.outstanding, "0.00");

    const plans = async (sql: string) => {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`EXPLAIN FORMAT=JSON ${sql}`);
      const raw = Object.values(rows[0] ?? {})[0];
      return explained(typeof raw === "string" ? JSON.parse(raw) : (raw as never));
    };
    const login = await plans("SELECT id FROM users WHERE email = 'nobody@example.com'");
    assert.equal(login.key, "users_email_idx");
    const products = await plans(
      "SELECT id FROM products WHERE organizationId = '00000000-0000-0000-0000-000000000000' AND deletedAt IS NULL ORDER BY name ASC LIMIT 200",
    );
    assert.equal(products.key, "products_organizationId_deletedAt_name_idx");
    const cash = await plans(
      "SELECT id FROM sale_payments WHERE organizationId = '00000000-0000-0000-0000-000000000000' AND method = 'CASH' AND createdAt >= '2026-01-01'",
    );
    assert.equal(cash.key, "sale_payments_organizationId_method_createdAt_idx");
    const ledger = await plans(
      "SELECT id FROM stock_ledgers WHERE organizationId = '00000000-0000-0000-0000-000000000000' AND branchId = '00000000-0000-0000-0000-000000000000' ORDER BY createdAt DESC LIMIT 100",
    );
    assert.equal(ledger.possible.includes("stock_ledgers_organizationId_branchId_createdAt_idx"), true);
    const journals = await plans(
      "SELECT id FROM journals WHERE organizationId = '00000000-0000-0000-0000-000000000000' AND branchId = '00000000-0000-0000-0000-000000000000' AND status = 'POSTED' AND businessDate >= '2026-01-01'",
    );
    assert.equal(journals.possible.includes("journals_organizationId_branchId_status_businessDate_idx"), true);
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
