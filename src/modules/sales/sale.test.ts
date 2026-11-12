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
process.env.AUTH_SECRET ??= "test-secret-phase-07-value";
process.env.BCRYPT_COST = "4";

test("phase 07 sales post stock, invoice, and a balanced journal", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { getSale, postSale } = await import("./sales.ts");
  const { holdTicket } = await import("./tickets.ts");
  const { outstandingReceivable } = await import("../customers/customers.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Sell A", slug: `sell-a-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Cashier",
      email: `cashier-${stamp}@example.com`,
      passwordHash: await hashPassword("correct-password"),
    },
  });
  const { ensureChart } = await import("../../core/ledger/chart.ts");
  await ensureChart(prisma, org.id);
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: `SELL-${stamp}`,
      liveSku: `SELL-${stamp}`,
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
    data: {
      organizationId: org.id,
      productId: product.id,
      branchId: branch.id,
      warehouseId: warehouse.id,
      quantity: "5.0000",
    },
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
  const customer = await prisma.customer.create({
    data: { organizationId: org.id, name: "City Grocers", creditLimit: "5.00", createdById: user.id },
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
    const held = await holdTicket({
      ...actor,
      idempotencyKey: randomUUID(),
      lines: [{ productId: product.id, quantity: "1" }],
    });
    assert.equal(held.ok, true);
    const afterHold = await prisma.stockBalance.findFirst({ where: { productId: product.id } });
    assert.equal(afterHold?.quantity.toFixed(4), "5.0000");

    const overpay = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: product.id, quantity: "1" }],
      paymentAmount: "100.00",
      paymentMethod: "CASH",
    });
    assert.equal(overpay.ok, false);

    const discount = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: product.id, quantity: "1", discountAmount: "1.00" }],
      paymentAmount: "12.00",
      paymentMethod: "CASH",
    });
    assert.equal(discount.ok, false);

    const override = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: product.id, quantity: "1", unitPrice: "99.00" }],
      paymentAmount: "12.00",
      paymentMethod: "CASH",
    });
    assert.equal(override.ok, false);

    const overLimit = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: "1" }],
      paymentAmount: "6.00",
      paymentMethod: "CASH",
    });
    assert.equal(overLimit.ok, false);

    const key = randomUUID();
    const sold = await postSale({
      ...actor,
      idempotencyKey: key,
      businessDate: "2026-10-01",
      ticketId: held.ok ? held.id : undefined,
      lines: [{ productId: product.id, quantity: "1" }],
      paymentAmount: "12.00",
      paymentMethod: "CASH",
    });
    assert.equal(sold.ok, true);
    if (sold.ok) {
      assert.match(sold.number ?? "", /^INV-2627-\d{6}$/);
      assert.equal(sold.total, "12.00");
    }
    const replay = await postSale({
      ...actor,
      idempotencyKey: key,
      businessDate: "2026-10-01",
      ticketId: held.ok ? held.id : undefined,
      lines: [{ productId: product.id, quantity: "1" }],
      paymentAmount: "12.00",
      paymentMethod: "CASH",
    });
    assert.equal(replay.ok && replay.replayed, true);
    const afterCash = await prisma.stockBalance.findFirst({ where: { productId: product.id } });
    assert.equal(afterCash?.quantity.toFixed(4), "4.0000");
    assert.equal(await prisma.heldTicket.count({ where: { organizationId: org.id } }), 0);

    const credit = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: "1" }],
      paymentAmount: "8.00",
      paymentMethod: "CASH",
    });
    assert.equal(credit.ok, true);
    const owed = await outstandingReceivable(org.id, customer.id);
    assert.equal(owed.toFixed(2), "4.00");
    if (credit.ok) {
      const detail = await getSale(org.id, branch.id, credit.id);
      assert.equal(detail?.journalBalanced, true);
      assert.equal(detail?.vatTotal, "0.00");
    }

    await prisma.stockLedger.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        branchId: branch.id,
        warehouseId: warehouse.id,
        quantity: "1.0000",
        direction: "IN",
        movementType: "PURCHASE",
        referenceType: "test",
        referenceId: randomUUID(),
        unitCost: "11.00",
        userId: user.id,
      },
    });
    // the stock on hand follows its movements (I4), so the unit received is on hand too
    await prisma.stockBalance.updateMany({ where: { organizationId: org.id, productId: product.id }, data: { quantity: { increment: "1.0000" } } });
    const mixed = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: product.id, quantity: "1" }],
      paymentAmount: "12.00",
      paymentMethod: "CASH",
    });
    assert.equal(mixed.ok, true);
    const afterMixed = await prisma.stockBalance.findFirst({ where: { productId: product.id } });
    assert.equal(afterMixed?.quantity.toFixed(4), "3.0000");

    const journals = await prisma.journal.findMany({ where: { organizationId: org.id }, include: { lines: true } });
    assert.equal(journals.length, 6, "stock in, and each of the two sales with its receipt");
    for (const journal of journals) {
      const debit = journal.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      const creditAmount = journal.lines.reduce((sum, line) => sum + Number(line.credit), 0);
      assert.equal(debit, creditAmount);
    }
    // The books agree with themselves and with the stock (I1, I2, I4, I7, I8, I15).
    const { assertBooksReconcile } = await import("../../core/reconcile/index.ts");
    await assertBooksReconcile(org.id);
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
