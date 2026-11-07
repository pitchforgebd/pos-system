import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Prisma } from "@prisma/client";

for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}
process.env.AUTH_SECRET ??= "test-secret-phase-18-value";
process.env.BCRYPT_COST = "4";

test("phase 18 checks money, numbers, permissions, and the sale path", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { decidePageAccess } = await import("../access/route-access.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { login } = await import("../auth/login.ts");
  const { resetRateLimits } = await import("../auth/rate-limit.ts");
  const { postCustomerPayment } = await import("../customers/dues.ts");
  const { outstandingReceivable } = await import("../customers/customers.ts");
  const { allocateNumber, documentYear } = await import("../documents/numbers.ts");
  const { createProduct } = await import("../catalog/products.ts");
  const { postOpeningStock } = await import("../inventory/documents.ts");
  const { decimalString, parseMoney, parseQuantity } = await import("../inventory/money.ts");
  const { ledgerMatchesBalance } = await import("../inventory/stock.ts");
  const { postSale } = await import("../sales/sales.ts");

  assert.equal(parseMoney("1.50")?.toFixed(2), "1.50");
  assert.equal(parseMoney("1.005"), null);
  assert.equal(parseQuantity("0"), null);
  assert.equal(decimalString(new Prisma.Decimal("1.005"), 2), "1.01");
  assert.equal(documentYear("2026-10-01"), 2026);
  assert.equal(decidePageAccess("/users", new Set(["sales.view"])), "forbidden");
  assert.equal(decidePageAccess("/pos", new Set(["sales.view"])), "allow");
  assert.equal(decidePageAccess("/users", null), "login");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "QA", slug: `qa-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Cashier",
      email: `qa-${stamp}@example.com`,
      passwordHash: await hashPassword("correct-password"),
    },
  });
  await prisma.userBranchAccess.create({ data: { organizationId: org.id, userId: user.id, branchId: branch.id } });
  const asset = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "1000", name: "Assets" } });
  const revenue = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "4000", name: "Revenue" } });
  const cost = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "5000", name: "Cost of Sales" } });
  await prisma.account.createMany({
    data: [
      { organizationId: org.id, groupId: asset.id, code: "1100", name: "Cash" },
      { organizationId: org.id, groupId: asset.id, code: "1300", name: "Accounts Receivable" },
      { organizationId: org.id, groupId: asset.id, code: "1400", name: "Inventory" },
      { organizationId: org.id, groupId: revenue.id, code: "4100", name: "Sales" },
      { organizationId: org.id, groupId: cost.id, code: "5100", name: "COGS" },
    ],
  });
  const actor = {
    organizationId: org.id,
    branchId: branch.id,
    userId: user.id,
    warehouseId: warehouse.id,
    ip: "203.0.113.18",
    userAgent: "qa",
  };

  try {
    const numbers = await prisma.$transaction(async (tx) => {
      const first = await allocateNumber(tx, { organizationId: org.id, documentType: "INV", year: 2026 });
      const second = await allocateNumber(tx, { organizationId: org.id, documentType: "INV", year: 2026 });
      return [first, second];
    });
    assert.deepEqual(numbers, ["INV-2026-000001", "INV-2026-000002"]);

    const created = await createProduct({
      ...actor,
      actorId: user.id,
      sku: `QA-${stamp}`,
      name: `Tea ${stamp}`,
      purchasePrice: "10.00",
      sellingPrice: "12.00",
      wholesalePrice: "11.00",
      minimumPrice: "10.00",
      trackStock: true,
      trackExpiry: false,
      trackBatch: false,
      trackSerial: false,
      reorderLevel: "0",
      warrantyAvailable: false,
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    const opened = await postOpeningStock({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: created.product.id, quantity: "2.0000", unitCost: "10.00" }],
    });
    assert.equal(opened.ok, true);
    const customer = await prisma.customer.create({ data: { organizationId: org.id, name: "Rina", createdById: user.id } });

    const discount = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      customerId: customer.id,
      lines: [{ productId: created.product.id, quantity: "1", discountAmount: "100.00" }],
      paymentAmount: "0.00",
    });
    assert.equal(discount.ok, false);
    const vat = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      customerId: customer.id,
      lines: [{ productId: created.product.id, quantity: "1", vatAmount: "1.00" }],
      paymentAmount: "0.00",
    });
    assert.equal(vat.ok, false);

    resetRateLimits();
    const signedIn = await login({ email: user.email, password: "correct-password", ip: actor.ip, userAgent: actor.userAgent });
    assert.equal(signedIn.ok, true);

    const sold = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      customerId: customer.id,
      lines: [{ productId: created.product.id, quantity: "1" }],
      paymentAmount: "2.00",
      paymentMethod: "CASH",
    });
    assert.equal(sold.ok, true);
    if (!sold.ok) {
      return;
    }
    assert.equal(sold.number, "INV-2026-000003");
    assert.equal(sold.total, "12.00");
    const collected = await postCustomerPayment({
      ...actor,
      idempotencyKey: randomUUID(),
      customerId: customer.id,
      businessDate: "2026-10-01",
      amount: "4.00",
      method: "CASH",
    });
    assert.equal(collected.ok, true);
    if (collected.ok) {
      assert.match(collected.number ?? "", /^PAY-2026-/);
    }

    const balance = await prisma.stockBalance.findFirst({ where: { productId: created.product.id } });
    assert.equal(balance?.quantity.toFixed(4), "1.0000");
    assert.equal(await ledgerMatchesBalance(org.id, branch.id), true);
    assert.equal((await outstandingReceivable(org.id, customer.id)).toFixed(2), "6.00");
    const journals = await prisma.journal.findMany({ where: { organizationId: org.id }, include: { lines: true } });
    assert.equal(journals.length, 2);
    for (const journal of journals) {
      const debit = journal.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
      const credit = journal.lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0));
      assert.equal(debit.eq(credit), true);
    }
    const audits = await prisma.auditLog.findMany({ where: { organizationId: org.id }, select: { action: true, entityId: true } });
    assert.equal(audits.some((row) => row.action === "login"), true);
    assert.equal(audits.some((row) => row.action === "sale" && row.entityId === sold.id), true);
    assert.equal(audits.some((row) => row.action === "payment"), true);

    const last = await createProduct({
      ...actor,
      actorId: user.id,
      sku: `LAST-${stamp}`,
      name: `Last ${stamp}`,
      purchasePrice: "10.00",
      sellingPrice: "12.00",
      wholesalePrice: "11.00",
      minimumPrice: "10.00",
      trackStock: true,
      trackExpiry: false,
      trackBatch: false,
      trackSerial: false,
      reorderLevel: "0",
      warrantyAvailable: false,
    });
    assert.equal(last.ok, true);
    if (!last.ok) {
      return;
    }
    const lastOpened = await postOpeningStock({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: last.product.id, quantity: "1.0000", unitCost: "10.00" }],
    });
    assert.equal(lastOpened.ok, true);
    const raced = await Promise.all([
      postSale({
        ...actor,
        idempotencyKey: randomUUID(),
        businessDate: "2026-10-01",
        lines: [{ productId: last.product.id, quantity: "1" }],
        paymentAmount: "12.00",
        paymentMethod: "CASH",
      }),
      postSale({
        ...actor,
        idempotencyKey: randomUUID(),
        businessDate: "2026-10-01",
        lines: [{ productId: last.product.id, quantity: "1" }],
        paymentAmount: "12.00",
        paymentMethod: "CASH",
      }),
    ]);
    assert.equal(raced.filter((result) => result.ok).length, 1);
    assert.equal(raced.some((result) => !result.ok && result.message === "Insufficient stock."), true);
    const lastBalance = await prisma.stockBalance.findFirst({ where: { productId: last.product.id } });
    assert.equal(lastBalance?.quantity.toFixed(4), "0.0000");
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockBalance.deleteMany({ where: { organizationId: org.id } });
    await prisma.salePayment.deleteMany({ where: { organizationId: org.id } });
    await prisma.saleItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.invoice.deleteMany({ where: { organizationId: org.id } });
    await prisma.sale.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.customerPayment.deleteMany({ where: { organizationId: org.id } });
    await prisma.journalLine.deleteMany({ where: { organizationId: org.id } });
    await prisma.journal.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.product.deleteMany({ where: { organizationId: org.id } });
    await prisma.account.deleteMany({ where: { organizationId: org.id } });
    await prisma.accountGroup.deleteMany({ where: { organizationId: org.id } });
    await prisma.documentSequence.deleteMany({ where: { organizationId: org.id } });
    await prisma.openingStock.deleteMany({ where: { organizationId: org.id } });
    await prisma.session.deleteMany({ where: { organizationId: org.id } });
    await prisma.userBranchAccess.deleteMany({ where: { organizationId: org.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.branch.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
