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
process.env.AUTH_SECRET ??= "test-secret-phase-12-value";

test("phase 12 shift cash uses the confirmed expected formula", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { postSaleReturn } = await import("../sales/returns.ts");
  const { postSale } = await import("../sales/sales.ts");
  const { activateShift, closeShift, countShift, handOverShift, openShift, postCashMovement } = await import("./shifts.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Shift A", slug: `shift-a-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Cashier", email: `cashier-${stamp}@example.com`, passwordHash: "not-used" },
  });
  const other = await prisma.user.create({
    data: { organizationId: org.id, name: "Closer", email: `closer-${stamp}@example.com`, passwordHash: "not-used" },
  });
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
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: `SHF-${stamp}`,
      liveSku: `SHF-${stamp}`,
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
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, warehouseId: warehouse.id, ip: "127.0.0.1", userAgent: "test" };

  try {
    const opened = await openShift({ ...actor, idempotencyKey: randomUUID(), openingCash: "10.00" });
    assert.equal(opened.ok, true);
    if (!opened.ok) {
      return;
    }
    const second = await openShift({ ...actor, idempotencyKey: randomUUID(), openingCash: "1.00" });
    assert.equal(second.ok, false);
    const early = await postCashMovement({ ...actor, idempotencyKey: randomUUID(), shiftId: opened.id, direction: "IN", amount: "5.00" });
    assert.equal(early.ok, false);
    const active = await activateShift({ ...actor, idempotencyKey: randomUUID(), shiftId: opened.id });
    assert.equal(active.ok, true);
    const cashIn = await postCashMovement({ ...actor, idempotencyKey: randomUUID(), shiftId: opened.id, direction: "IN", amount: "5.00" });
    const cashOut = await postCashMovement({ ...actor, idempotencyKey: randomUUID(), shiftId: opened.id, direction: "OUT", amount: "2.00" });
    assert.equal(cashIn.ok && cashOut.ok, true);

    const sale = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      occurredOn: "2026-10-01",
      lines: [{ productId: product.id, quantity: "1" }],
      paymentAmount: "12.00",
      paymentMethod: "CASH",
    });
    assert.equal(sale.ok, true);
    if (!sale.ok) {
      return;
    }
    const item = await prisma.saleItem.findFirst({ where: { saleId: sale.id } });
    const returned = await postSaleReturn({
      ...actor,
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      occurredOn: "2026-10-01",
      lines: [{ saleItemId: item?.id ?? "", quantity: "1" }],
    });
    assert.equal(returned.ok, true);

    const counted = await countShift({ ...actor, idempotencyKey: randomUUID(), shiftId: opened.id, actualCash: "13.00" });
    assert.equal(counted.ok, true);
    if (counted.ok && !counted.replayed) {
      assert.equal(counted.expectedCash, "13.00");
      assert.equal(counted.difference, "0.00");
    }
    const stored = await prisma.shift.findFirst({ where: { id: opened.id } });
    assert.equal(stored?.cashSales.toFixed(2), "12.00");
    assert.equal(stored?.refunds.toFixed(2), "12.00");
    assert.equal(stored?.status, "CLOSING");
    const journalsBeforeHandover = await prisma.journal.count({ where: { organizationId: org.id } });
    const handover = await handOverShift({
      ...actor,
      idempotencyKey: randomUUID(),
      shiftId: opened.id,
      toUserId: other.id,
      amount: "13.00",
    });
    assert.equal(handover.ok, true);
    const afterHandover = await prisma.shift.findFirst({ where: { id: opened.id } });
    assert.equal(afterHandover?.expectedCash.toFixed(2), "13.00");
    assert.equal(await prisma.journal.count({ where: { organizationId: org.id } }), journalsBeforeHandover);

    const closed = await closeShift({ ...actor, idempotencyKey: randomUUID(), shiftId: opened.id });
    assert.equal(closed.ok, true);
    const again = await closeShift({ ...actor, idempotencyKey: randomUUID(), shiftId: opened.id });
    assert.equal(again.ok, false);
    if (!again.ok) {
      assert.equal(again.message, "A closed shift cannot close again.");
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.cashHandover.deleteMany({ where: { organizationId: org.id } });
    await prisma.cashMovement.deleteMany({ where: { organizationId: org.id } });
    await prisma.shift.deleteMany({ where: { organizationId: org.id } });
    await prisma.saleReturnItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.saleReturn.deleteMany({ where: { organizationId: org.id } });
    await prisma.salePayment.deleteMany({ where: { organizationId: org.id } });
    await prisma.saleItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.invoice.deleteMany({ where: { organizationId: org.id } });
    await prisma.sale.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockBalance.deleteMany({ where: { organizationId: org.id } });
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
