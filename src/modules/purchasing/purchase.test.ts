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
process.env.AUTH_SECRET ??= "test-secret-phase-06-value";
process.env.BCRYPT_COST = "4";

test("phase 06 purchases and supplier balances", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { getPurchase, postPurchase, postSupplierPayment } = await import("./purchases.ts");
  const { createSupplier, getSupplier } = await import("./suppliers.ts");
  const { listStock } = await import("../inventory/stock.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Buy A", slug: `buy-a-${stamp}` } });
  const other = await prisma.organization.create({ data: { name: "Buy B", slug: `buy-b-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Buyer",
      email: `buyer-${stamp}@example.com`,
      passwordHash: await hashPassword("correct-password"),
    },
  });
  const asset = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "1000", name: "Assets" } });
  const liability = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "2000", name: "Liabilities" } });
  await prisma.account.createMany({
    data: [
      { organizationId: org.id, groupId: asset.id, code: "1100", name: "Cash" },
      { organizationId: org.id, groupId: asset.id, code: "1200", name: "Bank" },
      { organizationId: org.id, groupId: asset.id, code: "1400", name: "Inventory" },
      { organizationId: org.id, groupId: liability.id, code: "2100", name: "Accounts Payable" },
    ],
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: `BUY-${stamp}`,
      liveSku: `BUY-${stamp}`,
      name: "Rice",
      slug: `rice-${stamp}`,
      purchasePrice: "10.00",
      sellingPrice: "12.00",
      wholesalePrice: "11.00",
      minimumPrice: "10.00",
      trackStock: true,
      trackExpiry: false,
      trackBatch: false,
      trackSerial: false,
    },
  });
  const actor = {
    organizationId: org.id,
    branchId: branch.id,
    userId: user.id,
    warehouseId: warehouse.id,
    ip: "127.0.0.1",
    userAgent: "test",
  };

  try {
    const supplier = await createSupplier({
      organizationId: org.id,
      actorId: user.id,
      name: "Mill",
      openingPayable: "0.00",
      creditLimit: "10.00",
      ip: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal(supplier.ok, true);
    if (!supplier.ok) {
      return;
    }
    assert.equal(await getSupplier(other.id, supplier.supplier.id), null);

    const over = await postPurchase({
      ...actor,
      idempotencyKey: randomUUID(),
      supplierId: supplier.supplier.id,
      businessDate: "2026-10-01",
      lines: [{ productId: product.id, quantity: "2", unitCost: "10.00" }],
    });
    assert.equal(over.ok, false);
    assert.equal((await listStock({ organizationId: org.id, branchId: branch.id })).length, 0);

    const key = randomUUID();
    const bought = await postPurchase({
      ...actor,
      idempotencyKey: key,
      supplierId: supplier.supplier.id,
      businessDate: "2026-10-01",
      paymentAmount: "4.00",
      paymentMethod: "CASH",
      lines: [{ productId: product.id, quantity: "1", unitCost: "10.00" }],
    });
    assert.equal(bought.ok, true);
    if (!bought.ok) {
      return;
    }
    assert.match(bought.number ?? "", /^PUR-2627-\d{6}$/);
    const replay = await postPurchase({
      ...actor,
      idempotencyKey: key,
      supplierId: supplier.supplier.id,
      businessDate: "2026-10-01",
      paymentAmount: "4.00",
      paymentMethod: "CASH",
      lines: [{ productId: product.id, quantity: "1", unitCost: "10.00" }],
    });
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.replayed, true);
    }
    const stock = await listStock({ organizationId: org.id, branchId: branch.id });
    assert.equal(stock[0]?.quantity, "1.0000");
    const detail = await getPurchase(org.id, branch.id, bought.id);
    assert.equal(detail?.total, "10.00");
    assert.equal(detail?.vatTotal, "0.00");
    assert.equal(detail?.journalBalanced, true);
    const afterBuy = await getSupplier(org.id, supplier.supplier.id);
    assert.equal(afterBuy?.outstanding, "6.00");

    const tooMuch = await postSupplierPayment({
      ...actor,
      idempotencyKey: randomUUID(),
      supplierId: supplier.supplier.id,
      businessDate: "2026-10-02",
      amount: "7.00",
      method: "BANK",
    });
    assert.equal(tooMuch.ok, false);
    const paid = await postSupplierPayment({
      ...actor,
      idempotencyKey: randomUUID(),
      supplierId: supplier.supplier.id,
      businessDate: "2026-10-02",
      amount: "6.00",
      method: "BANK",
    });
    assert.equal(paid.ok, true);
    const settled = await getSupplier(org.id, supplier.supplier.id);
    assert.equal(settled?.outstanding, "0.00");

    const journals = await prisma.journal.findMany({
      where: { organizationId: org.id },
      include: { lines: true },
    });
    for (const journal of journals) {
      const debit = journal.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      const credit = journal.lines.reduce((sum, line) => sum + Number(line.credit), 0);
      assert.equal(debit, credit);
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.stockLedger.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.stockBalance.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.purchasePayment.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.purchaseItem.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.purchase.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.supplierPayment.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.journalLine.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.journal.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.supplierLedger.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.supplier.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.product.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.account.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.accountGroup.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.documentSequence.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.warehouse.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.branch.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, other.id] } } });
    await prisma.$disconnect();
  }
});
