import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

test("phase 14 reports sum posted rows and keep the trial balance equal", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const {
    cashReport,
    customerReport,
    dayBook,
    inventoryReport,
    profitAndLoss,
    purchaseReport,
    salesReport,
    supplierReport,
    trialBalance,
  } = await import("./reports.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Report A", slug: `report-a-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const other = await prisma.branch.create({ data: { organizationId: org.id, name: "Other" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const { ensureChart } = await import("../../core/ledger/chart.ts");
  await ensureChart(prisma, org.id);
  const accounts = await prisma.account.findMany({ where: { organizationId: org.id } });
  const byCode = new Map(accounts.map((account) => [account.code, account.id]));
  const customer = await prisma.customer.create({ data: { organizationId: org.id, name: "Pantry", openingBalance: "100.00" } });
  const supplier = await prisma.supplier.create({ data: { organizationId: org.id, name: "Mill", openingPayable: "100.00" } });
  const scope = { organizationId: org.id, branchId: branch.id };

  async function post(description: string, lines: [string, string, string][]) {
    const journal = await prisma.journal.create({
      data: { organizationId: org.id, branchId: branch.id, status: "POSTED", description, businessDate: new Date("2026-10-01T00:00:00.000Z") },
    });
    await prisma.journalLine.createMany({
      data: lines.map(([code, debit, credit]) => ({
        organizationId: org.id,
        journalId: journal.id,
        accountId: byCode.get(code) ?? "",
        debit,
        credit,
        branchId: branch.id,
        businessDate: new Date("2026-10-01T00:00:00.000Z"),
      })),
    });
  }

  try {
    const included = await prisma.sale.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        status: "POSTED",
        total: "10.00",
        businessDate: new Date("2026-10-01T00:00:00.000Z"),
        invoice: { create: { organizationId: org.id, branchId: branch.id, number: `RPT-${stamp}`, total: "10.00" } },
      },
    });
    await prisma.sale.create({
      data: { organizationId: org.id, branchId: branch.id, status: "POSTED", total: "2.50", businessDate: new Date("2026-10-02T00:00:00.000Z") },
    });
    await prisma.sale.create({
      data: { organizationId: org.id, branchId: branch.id, status: "DRAFT", total: "99.00", businessDate: new Date("2026-10-01T00:00:00.000Z") },
    });
    await prisma.sale.create({
      data: { organizationId: org.id, branchId: other.id, status: "POSTED", total: "50.00", businessDate: new Date("2026-10-01T00:00:00.000Z") },
    });
    await prisma.purchase.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        supplierId: supplier.id,
        status: "POSTED",
        number: `PUR-${stamp}`,
        total: "7.00",
        businessDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    await prisma.customerLedger.create({
      data: { organizationId: org.id, customerId: customer.id, businessDate: new Date("2026-10-01T00:00:00.000Z"), entryType: "OPENING", debit: "8.00", credit: "0.00" },
    });
    await prisma.customerLedger.create({
      data: { organizationId: org.id, customerId: customer.id, businessDate: new Date("2026-10-02T00:00:00.000Z"), entryType: "PAYMENT", debit: "0.00", credit: "3.00" },
    });
    await prisma.supplierLedger.create({
      data: { organizationId: org.id, supplierId: supplier.id, businessDate: new Date("2026-10-01T00:00:00.000Z"), entryType: "OPENING", debit: "0.00", credit: "7.00" },
    });
    await prisma.supplierLedger.create({
      data: { organizationId: org.id, supplierId: supplier.id, businessDate: new Date("2026-10-02T00:00:00.000Z"), entryType: "PAYMENT", debit: "2.00", credit: "0.00" },
    });

    const sales = await salesReport(scope);
    assert.equal(sales.total, "12.50");
    assert.equal(sales.count, 2);
    const filtered = await salesReport({ ...scope, from: "2026-10-02", to: "2026-10-02" });
    assert.equal(filtered.total, "2.50");
    assert.equal(filtered.count, 1);
    const ignored = await salesReport({ ...scope, from: "2026-10-03", to: "2026-10-01" });
    assert.equal(ignored.total, "12.50");
    assert.equal(sales.rows.find((row) => row.id === included.id)?.number, `RPT-${stamp}`);
    assert.equal((await purchaseReport(scope)).total, "7.00");

    const customers = await customerReport(org.id);
    assert.equal(customers.rows.find((row) => row.id === customer.id)?.due, "5.00");
    const suppliers = await supplierReport(org.id);
    assert.equal(suppliers.rows.find((row) => row.id === supplier.id)?.payable, "5.00");

    const products = [
      ["zero", "0.0000", "5.0000"],
      ["low", "2.0000", "5.0000"],
      ["ok", "8.0000", "5.0000"],
    ] as const;
    for (const [name, quantity, reorderLevel] of products) {
      const product = await prisma.product.create({
        data: {
          organizationId: org.id,
          sku: `${name}-${stamp}`,
          liveSku: `${name}-${stamp}`,
          name,
          slug: `${name}-${stamp}`,
          purchasePrice: "1.00",
          sellingPrice: "2.00",
          wholesalePrice: "1.50",
          minimumPrice: "1.00",
          trackStock: true,
          trackExpiry: false,
          trackBatch: false,
          trackSerial: false,
          reorderLevel,
        },
      });
      await prisma.stockBalance.create({
        data: { organizationId: org.id, productId: product.id, branchId: branch.id, warehouseId: warehouse.id, quantity },
      });
    }
    const stock = await inventoryReport(scope);
    const statusOf = (name: string) => stock.rows.find((row) => row.product === name)?.status;
    assert.equal(statusOf("zero"), "OUT_OF_STOCK");
    assert.equal(statusOf("low"), "LOW");
    assert.equal(statusOf("ok"), "NORMAL");

    await post("sale", [["1100", "10.00", "0.00"], ["4100", "0.00", "10.00"]]);
    await post("cost", [["5100", "4.00", "0.00"], ["1100", "0.00", "4.00"]]);
    await post("rent", [["6100", "1.00", "0.00"], ["1100", "0.00", "1.00"]]);

    const trial = await trialBalance(scope);
    assert.equal(trial.balanced, true);
    assert.equal(trial.debit, trial.credit);
    assert.equal(trial.debit, "15.00");
    const book = await dayBook(scope);
    assert.equal(book.balanced, true);
    assert.equal(book.debit, book.credit);
    const result = await profitAndLoss(scope);
    assert.equal(result.revenue, "10.00");
    assert.equal(result.cost, "4.00");
    assert.equal(result.gross, "6.00");
    assert.equal(result.expenses, "1.00");
    assert.equal(result.net, "5.00");
    assert.equal(result.rows.some((row) => row.code === "1100"), false);
    const cash = await cashReport(scope);
    assert.equal(cash.debit, "10.00");
    assert.equal(cash.credit, "5.00");
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
