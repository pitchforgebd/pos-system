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
process.env.AUTH_SECRET ??= "test-secret-quotation-convert-value";
process.env.BCRYPT_COST = "4";

test("converting a quotation creates exactly one sale, even when asked twice at once", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { acceptQuotation, convertQuotation, createQuotation, sendQuotation } = await import("./quotations.ts");

  const stamp = `${Date.now()}-qc`;
  const org = await prisma.organization.create({ data: { name: "Quote convert", slug: `quote-convert-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Clerk", email: `qc-${stamp}@example.com`, passwordHash: await hashPassword("correct-password") },
  });
  const customer = await prisma.customer.create({ data: { organizationId: org.id, name: "Harbor Pantry", createdById: user.id } });
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
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: `QC-${stamp}`,
      liveSku: `QC-${stamp}`,
      name: "Flour",
      slug: `flour-${stamp}`,
      purchasePrice: "5.00",
      sellingPrice: "10.00",
      wholesalePrice: "10.00",
      minimumPrice: "5.00",
      trackStock: true,
      trackExpiry: false,
      trackBatch: false,
      trackSerial: false,
    },
  });
  await prisma.stockBalance.create({
    data: { organizationId: org.id, productId: product.id, branchId: branch.id, warehouseId: warehouse.id, quantity: "10.0000" },
  });
  await prisma.stockLedger.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      branchId: branch.id,
      warehouseId: warehouse.id,
      quantity: "10.0000",
      direction: "IN",
      movementType: "OPENING",
      referenceType: "test",
      referenceId: product.id,
      unitCost: "5.00",
      userId: user.id,
    },
  });
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, ip: "127.0.0.1", userAgent: "test" };

  try {
    const created = await createQuotation({
      ...actor,
      idempotencyKey: randomUUID(),
      customerId: customer.id,
      businessDate: "2026-10-01",
      lines: [{ productId: product.id, quantity: "2", unitPrice: "10.00" }],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal((await sendQuotation({ ...actor, quotationId: created.id })).ok, true);
    assert.equal((await acceptQuotation({ ...actor, quotationId: created.id })).ok, true);

    const convert = () => convertQuotation({ ...actor, quotationId: created.id, idempotencyKey: randomUUID() });
    const raced = await Promise.all([convert(), convert()]);

    assert.equal(raced.filter((result) => result.ok && !result.replayed).length, 1);
    assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), 1);
    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
    assert.ok(stored.saleId);
    assert.equal(stored.status, "ACCEPTED");
    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: org.id, productId: product.id } });
    assert.equal(balance.quantity.toFixed(4), "8.0000");

    const again = await convert();
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.replayed, true);
      assert.equal(again.id, stored.saleId);
    }
    assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), 1);
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockBalance.deleteMany({ where: { organizationId: org.id } });
    await prisma.quotationItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.quotation.deleteMany({ where: { organizationId: org.id } });
    await prisma.salePayment.deleteMany({ where: { organizationId: org.id } });
    await prisma.saleItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.invoice.deleteMany({ where: { organizationId: org.id } });
    await prisma.sale.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.journalLine.deleteMany({ where: { organizationId: org.id } });
    await prisma.journal.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
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
