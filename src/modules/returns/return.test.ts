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
process.env.AUTH_SECRET ??= "test-secret-phase-08-value";
process.env.BCRYPT_COST = "4";

test("phase 08 returns cannot exceed the eligible quantity", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { outstandingReceivable } = await import("../customers/customers.ts");
  const { postPurchase } = await import("../purchasing/purchases.ts");
  const { postPurchaseReturn } = await import("../purchasing/returns.ts");
  const { createSupplier, outstandingPayable } = await import("../purchasing/suppliers.ts");
  const { getSale, postSale } = await import("../sales/sales.ts");
  const { postSaleReturn } = await import("../sales/returns.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Return A", slug: `return-a-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Cashier", email: `return-${stamp}@example.com`, passwordHash: await hashPassword("correct-password") },
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
      { organizationId: org.id, groupId: liability.id, code: "2100", name: "Accounts Payable" },
      { organizationId: org.id, groupId: revenue.id, code: "4100", name: "Sales" },
      { organizationId: org.id, groupId: cost.id, code: "5100", name: "COGS" },
    ],
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: `RET-${stamp}`,
      liveSku: `RET-${stamp}`,
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
  await prisma.stockBalance.create({
    data: { organizationId: org.id, productId: product.id, branchId: branch.id, warehouseId: warehouse.id, quantity: "5.0000" },
  });
  await prisma.stockLedger.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      branchId: branch.id,
      warehouseId: warehouse.id,
      quantity: "5.0000",
      direction: "IN",
      movementType: "OPENING",
      referenceType: "test",
      referenceId: product.id,
      unitCost: "10.00",
      userId: user.id,
    },
  });
  const customer = await prisma.customer.create({ data: { organizationId: org.id, name: "City Grocers", createdById: user.id } });
  const supplier = await createSupplier({
    organizationId: org.id,
    actorId: user.id,
    name: "Mill",
    openingPayable: "0.00",
    ip: "127.0.0.1",
    userAgent: "test",
  });
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, warehouseId: warehouse.id, ip: "127.0.0.1", userAgent: "test" };

  async function stock() {
    const row = await prisma.stockBalance.findFirst({ where: { productId: product.id } });
    return row?.quantity.toFixed(4);
  }

  try {
    assert.equal(supplier.ok, true);
    const supplierId = supplier.ok ? supplier.supplier.id : "";
    const sold = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: product.id, quantity: "2" }],
      paymentAmount: "24.00",
      paymentMethod: "CASH",
    });
    assert.equal(sold.ok, true);
    const sale = sold.ok ? await getSale(org.id, branch.id, sold.id) : null;
    const saleItemId = sale?.items[0]?.id ?? "";
    const tooMuch = await postSaleReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      saleId: sold.ok ? sold.id : "",
      businessDate: "2026-10-02",
      lines: [{ saleItemId, quantity: "3" }],
    });
    assert.equal(tooMuch.ok, false);
    assert.equal(await stock(), "3.0000");

    const key = randomUUID();
    const returned = await postSaleReturn({
      ...actor,
      idempotencyKey: key,
      saleId: sold.ok ? sold.id : "",
      businessDate: "2026-10-02",
      lines: [{ saleItemId, quantity: "1" }],
    });
    assert.equal(returned.ok, true);
    if (returned.ok) {
      assert.match(returned.number ?? "", /^RET-2627-\d{6}$/);
      assert.equal(returned.total, "12.00");
    }
    const replay = await postSaleReturn({
      ...actor,
      idempotencyKey: key,
      saleId: sold.ok ? sold.id : "",
      businessDate: "2026-10-02",
      lines: [{ saleItemId, quantity: "1" }],
    });
    assert.equal(replay.ok && replay.replayed, true);
    assert.equal(await stock(), "4.0000");
    const again = await postSaleReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      saleId: sold.ok ? sold.id : "",
      businessDate: "2026-10-02",
      lines: [{ saleItemId, quantity: "2" }],
    });
    assert.equal(again.ok, false);

    const credit = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: "1" }],
      paymentAmount: "0.00",
    });
    assert.equal(credit.ok, true);
    const creditSale = credit.ok ? await getSale(org.id, branch.id, credit.id) : null;
    const creditReturn = await postSaleReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      saleId: credit.ok ? credit.id : "",
      businessDate: "2026-10-02",
      lines: [{ saleItemId: creditSale?.items[0]?.id ?? "", quantity: "1" }],
    });
    assert.equal(creditReturn.ok, true);
    assert.equal((await outstandingReceivable(org.id, customer.id)).toFixed(2), "0.00");

    const partial = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: "1" }],
      paymentAmount: "8.00",
      paymentMethod: "CASH",
    });
    assert.equal(partial.ok, true);
    const partialSale = partial.ok ? await getSale(org.id, branch.id, partial.id) : null;
    const partialReturn = await postSaleReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      saleId: partial.ok ? partial.id : "",
      businessDate: "2026-10-02",
      lines: [{ saleItemId: partialSale?.items[0]?.id ?? "", quantity: "1" }],
    });
    assert.equal(partialReturn.ok, true);
    assert.equal((await outstandingReceivable(org.id, customer.id)).toFixed(2), "0.00");
    if (partialReturn.ok) {
      const lines = await prisma.journalLine.findMany({
        where: { journal: { saleReturn: { id: partialReturn.id } } },
        include: { account: { select: { code: true } } },
      });
      const creditOf = (code: string) => lines.find((line) => line.account.code === code)?.credit.toFixed(2);
      assert.equal(creditOf("1300"), "4.00");
      assert.equal(creditOf("1100"), "8.00");
    }

    const bought = await postPurchase({
      ...actor,
      idempotencyKey: randomUUID(),
      supplierId,
      businessDate: "2026-10-01",
      lines: [{ productId: product.id, quantity: "1", unitCost: "10.00" }],
      paymentAmount: "10.00",
      paymentMethod: "CASH",
    });
    assert.equal(bought.ok, true);
    const purchase = bought.ok
      ? await prisma.purchaseItem.findFirst({ where: { purchaseId: bought.id }, select: { id: true } })
      : null;
    const missingMethod = await postPurchaseReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      purchaseId: bought.ok ? bought.id : "",
      businessDate: "2026-10-03",
      lines: [{ purchaseItemId: purchase?.id ?? "", quantity: "1" }],
    });
    assert.equal(missingMethod.ok, false);
    const supplierReturn = await postPurchaseReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      purchaseId: bought.ok ? bought.id : "",
      businessDate: "2026-10-03",
      refundMethod: "CASH",
      lines: [{ purchaseItemId: purchase?.id ?? "", quantity: "1" }],
    });
    assert.equal(supplierReturn.ok, true);
    if (supplierReturn.ok) {
      assert.match(supplierReturn.number ?? "", /^RET-2627-\d{6}$/);
    }
    const duplicate = await postPurchaseReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      purchaseId: bought.ok ? bought.id : "",
      businessDate: "2026-10-03",
      refundMethod: "CASH",
      lines: [{ purchaseItemId: purchase?.id ?? "", quantity: "1" }],
    });
    assert.equal(duplicate.ok, false);
    assert.equal((await outstandingPayable(org.id, supplierId)).toFixed(2), "0.00");

    const journals = await prisma.journal.findMany({ where: { organizationId: org.id }, include: { lines: true } });
    for (const journal of journals) {
      const debit = journal.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      const creditAmount = journal.lines.reduce((sum, line) => sum + Number(line.credit), 0);
      assert.equal(debit, creditAmount);
    }
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
