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
  await prisma.customerLedger.createMany({
    data: [
      { organizationId: org.id, customerId: owed.id, businessDate: new Date("2026-10-01T00:00:00.000Z"), entryType: "OPENING", debit: "8.00", credit: "0.00" },
      { organizationId: org.id, customerId: owed.id, businessDate: new Date("2026-10-01T00:00:00.000Z"), entryType: "PAYMENT", debit: "0.00", credit: "3.00" },
    ],
  });

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
    await prisma.customerLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
