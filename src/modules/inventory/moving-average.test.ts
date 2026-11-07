import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}
process.env.AUTH_SECRET ??= "test-secret-moving-average-value";
process.env.BCRYPT_COST = "4";

test("the cost of goods sold follows the moving average of the stock on hand", async () => {
  const { Prisma } = await import("@prisma/client");
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { postAdjustment, postOpeningStock, postOwnStock } = await import("./documents.ts");
  const { nextAverageCost } = await import("./stock.ts");
  const { postSale } = await import("../sales/sales.ts");

  const decimal = (value: string | number) => new Prisma.Decimal(value);
  // The pure rule first.
  assert.equal(nextAverageCost({ onHand: decimal(0), average: null, direction: "IN", quantity: decimal(10), unitCost: decimal(10) })?.toFixed(4), "10.0000");
  assert.equal(nextAverageCost({ onHand: decimal(10), average: decimal(10), direction: "IN", quantity: decimal(10), unitCost: decimal(20) })?.toFixed(4), "15.0000");
  assert.equal(nextAverageCost({ onHand: decimal(10), average: decimal(15), direction: "OUT", quantity: decimal(4), unitCost: decimal(99) })?.toFixed(4), "15.0000");
  assert.equal(nextAverageCost({ onHand: decimal(10), average: decimal(15), direction: "IN", quantity: decimal(4), unitCost: null })?.toFixed(4), "15.0000");
  assert.equal(nextAverageCost({ onHand: decimal(0), average: decimal(15), direction: "IN", quantity: decimal(4), unitCost: decimal(8) })?.toFixed(4), "8.0000");
  assert.equal(nextAverageCost({ onHand: decimal(3), average: null, direction: "IN", quantity: decimal(4), unitCost: null }), null);

  const stamp = `${Date.now()}-avg`;
  const org = await prisma.organization.create({ data: { name: "Average", slug: `average-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Keeper", email: `avg-${stamp}@example.com`, passwordHash: await hashPassword("correct-password") },
  });
  const asset = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "1000", name: "Assets" } });
  const liability = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "2000", name: "Liabilities" } });
  const revenue = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "4000", name: "Revenue" } });
  const cost = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "5000", name: "Cost of Sales" } });
  await prisma.account.createMany({
    data: [
      { organizationId: org.id, groupId: asset.id, code: "1100", name: "Cash" },
      { organizationId: org.id, groupId: asset.id, code: "1200", name: "Bank" },
      { organizationId: org.id, groupId: asset.id, code: "1300", name: "Accounts Receivable" },
      { organizationId: org.id, groupId: asset.id, code: "1400", name: "Inventory" },
      { organizationId: org.id, groupId: liability.id, code: "2300", name: "VAT Payable" },
      { organizationId: org.id, groupId: revenue.id, code: "4100", name: "Sales" },
      { organizationId: org.id, groupId: revenue.id, code: "4200", name: "Other Charges" },
      { organizationId: org.id, groupId: cost.id, code: "5100", name: "COGS" },
    ],
  });
  async function product(code: string, purchasePrice: string) {
    return prisma.product.create({
      data: {
        organizationId: org.id,
        sku: `${code}-${stamp}`,
        liveSku: `${code}-${stamp}`,
        name: code,
        slug: `${code}-${stamp}`.toLowerCase(),
        purchasePrice,
        sellingPrice: "50.00",
        wholesalePrice: "50.00",
        minimumPrice: "1.00",
        trackStock: true,
        trackExpiry: false,
        trackBatch: false,
        trackSerial: false,
      },
    });
  }
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, warehouseId: warehouse.id, ip: "127.0.0.1", userAgent: "test" };

  async function sell(productId: string, quantity: string, payment: string) {
    const sold = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      occurredOn: "2026-10-05",
      lines: [{ productId, quantity }],
      paymentAmount: payment,
      paymentMethod: "CASH",
    });
    assert.equal(sold.ok, true);
    const ledger = await prisma.stockLedger.findFirstOrThrow({
      where: { organizationId: org.id, productId, movementType: "SALE", referenceId: sold.ok ? sold.id : "" },
    });
    return ledger.unitCost?.toFixed(4);
  }
  async function average(productId: string) {
    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: org.id, productId } });
    return balance.averageCost?.toFixed(4) ?? null;
  }
  const stockIn = (productId: string, quantity: string, unitCost: string, kind: "open" | "own") =>
    (kind === "open" ? postOpeningStock : postOwnStock)({
      ...actor,
      idempotencyKey: randomUUID(),
      occurredOn: "2026-10-01",
      lines: [{ productId, quantity, unitCost }],
    });

  try {
    const rice = await product("RICE", "9.00");
    assert.equal((await stockIn(rice.id, "10", "10.00", "open")).ok, true);
    assert.equal((await stockIn(rice.id, "10", "20.00", "own")).ok, true);
    assert.equal(await average(rice.id), "15.0000");

    // Selling does not move the average; the sale is costed at 15.00 a unit.
    assert.equal(await sell(rice.id, "5", "250.00"), "15.0000");
    assert.equal(await average(rice.id), "15.0000");

    // 15 on hand at 15.00, then 5 more at 30.00: (15*15 + 5*30) / 20 = 18.75.
    assert.equal((await stockIn(rice.id, "5", "30.00", "own")).ok, true);
    assert.equal(await average(rice.id), "18.7500");
    assert.equal(await sell(rice.id, "4", "200.00"), "18.7500");

    // A stock-in that carries no cost leaves the average as it is.
    const adjusted = await postAdjustment({ ...actor, idempotencyKey: randomUUID(), productId: rice.id, quantity: "2", direction: "IN", reason: "found" });
    assert.equal(adjusted.ok, true);
    assert.equal(await average(rice.id), "18.7500");

    // Stock that never had a cost is costed at the product's purchase price, and the sale still goes through.
    const salt = await product("SALT", "4.50");
    assert.equal((await postAdjustment({ ...actor, idempotencyKey: randomUUID(), productId: salt.id, quantity: "3", direction: "IN", reason: "count" })).ok, true);
    assert.equal(await average(salt.id), null);
    assert.equal(await sell(salt.id, "1", "50.00"), "4.5000");

    // The ledger of the books agrees: cost of goods sold is the sum of what the sales were costed at.
    const cogs = await prisma.journalLine.aggregate({
      where: { organizationId: org.id, account: { code: "5100" } },
      _sum: { debit: true },
    });
    assert.equal(Number(cogs._sum.debit).toFixed(2), (5 * 15 + 4 * 18.75 + 4.5).toFixed(2));
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockBalance.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockAdjustment.deleteMany({ where: { organizationId: org.id } });
    await prisma.openingStock.deleteMany({ where: { organizationId: org.id } });
    await prisma.ownStockInvoice.deleteMany({ where: { organizationId: org.id } });
    await prisma.salePayment.deleteMany({ where: { organizationId: org.id } });
    await prisma.saleItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.invoice.deleteMany({ where: { organizationId: org.id } });
    await prisma.sale.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.journalLine.deleteMany({ where: { organizationId: org.id } });
    await prisma.journal.deleteMany({ where: { organizationId: org.id } });
    await prisma.product.deleteMany({ where: { organizationId: org.id } });
    await prisma.account.deleteMany({ where: { organizationId: org.id } });
    await prisma.accountGroup.deleteMany({ where: { organizationId: org.id } });
    await prisma.documentSequence.deleteMany({ where: { organizationId: org.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.branch.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
