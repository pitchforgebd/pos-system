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
process.env.AUTH_SECRET ??= "test-secret-expiry-lots-value";
process.env.BCRYPT_COST = "4";

test("stock going out uses up the expiry lots, earliest expiry first", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { postAdjustment, postDamage, postOpeningStock, postOwnStock, writeOffExpiry } = await import("./documents.ts");
  const { postSale } = await import("../sales/sales.ts");

  const stamp = `${Date.now()}-lots`;
  const org = await prisma.organization.create({ data: { name: "Lots", slug: `lots-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Keeper", email: `lots-${stamp}@example.com`, passwordHash: await hashPassword("correct-password") },
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
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: `LOT-${stamp}`,
      liveSku: `LOT-${stamp}`,
      name: "Milk",
      slug: `milk-${stamp}`,
      purchasePrice: "1.00",
      sellingPrice: "2.00",
      wholesalePrice: "2.00",
      minimumPrice: "1.00",
      trackStock: true,
      trackExpiry: true,
      trackBatch: false,
      trackSerial: false,
    },
  });
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, warehouseId: warehouse.id, ip: "127.0.0.1", userAgent: "test" };

  async function lots() {
    const rows = await prisma.expiryBatch.findMany({ where: { organizationId: org.id }, orderBy: { lot: "asc" } });
    return Object.fromEntries(rows.map((row) => [row.lot, row.quantity.toFixed(0)]));
  }
  async function stock() {
    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: org.id, productId: product.id } });
    return balance.quantity.toFixed(0);
  }
  async function lotTotal() {
    const rows = await prisma.expiryBatch.findMany({ where: { organizationId: org.id } });
    return rows.reduce((sum, row) => sum + Number(row.quantity), 0).toFixed(0);
  }

  try {
    // Entered in the "wrong" order: the later lot first. The earlier expiry must still go first.
    for (const [lot, expiresOn] of [
      ["L2", "2026-12-01"],
      ["L1", "2026-11-01"],
    ] as const) {
      const opened = await postOpeningStock({
        ...actor,
        idempotencyKey: randomUUID(),
        businessDate: "2026-10-01",
        lines: [{ productId: product.id, quantity: "5", unitCost: "1.00", lot, expiresOn }],
      });
      assert.equal(opened.ok, true);
    }
    assert.deepEqual(await lots(), { L1: "5", L2: "5" });

    const sold = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-02",
      lines: [{ productId: product.id, quantity: "6" }],
      paymentAmount: "12.00",
      paymentMethod: "CASH",
    });
    assert.equal(sold.ok, true);
    assert.deepEqual(await lots(), { L1: "0", L2: "4" });
    assert.equal(await stock(), await lotTotal());

    const adjusted = await postAdjustment({
      ...actor,
      idempotencyKey: randomUUID(),
      productId: product.id,
      quantity: "1",
      direction: "OUT",
      reason: "count",
    });
    assert.equal(adjusted.ok, true);
    assert.deepEqual(await lots(), { L1: "0", L2: "3" });

    const added = await postOwnStock({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-03",
      lines: [{ productId: product.id, quantity: "4", unitCost: "1.00", lot: "L3", expiresOn: "2027-01-01" }],
    });
    assert.equal(added.ok, true);
    assert.equal(await stock(), "7");

    // Damage that names a lot takes from that lot, not from the earliest one.
    const damaged = await postDamage({
      ...actor,
      idempotencyKey: randomUUID(),
      productId: product.id,
      businessDate: "2026-10-03",
      place: "Shelf",
      lot: "L3",
      purchasePrice: "1.00",
      salePrice: "2.00",
      discountAmount: "0.00",
      vatAmount: "0.00",
      quantity: "2",
      reason: "leak",
    });
    assert.equal(damaged.ok, true);
    assert.deepEqual(await lots(), { L1: "0", L2: "3", L3: "2" });

    // An expiry write-off names its own lot and is not counted twice.
    const l2 = await prisma.expiryBatch.findFirstOrThrow({ where: { organizationId: org.id, lot: "L2" } });
    const wroteOff = await writeOffExpiry({ ...actor, idempotencyKey: randomUUID(), batchId: l2.id, quantity: "3" });
    assert.equal(wroteOff.ok, true);
    assert.deepEqual(await lots(), { L1: "0", L2: "0", L3: "2" });
    assert.equal(await stock(), "2");
    assert.equal(await stock(), await lotTotal());

    // A refused sale leaves the lots alone.
    const tooMuch = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-04",
      lines: [{ productId: product.id, quantity: "3" }],
      paymentAmount: "6.00",
      paymentMethod: "CASH",
    });
    assert.equal(tooMuch.ok, false);
    assert.deepEqual(await lots(), { L1: "0", L2: "0", L3: "2" });

    // Stock past its expiry date is on hand but cannot be sold.
    const old = await postOwnStock({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-04",
      lines: [{ productId: product.id, quantity: "3", unitCost: "1.00", lot: "OLD", expiresOn: "2026-09-01" }],
    });
    assert.equal(old.ok, true);
    assert.equal(await stock(), "5");
    const sale = (quantity: string, businessDate = "2026-10-04") =>
      postSale({
        ...actor,
        idempotencyKey: randomUUID(),
        businessDate,
        lines: [{ productId: product.id, quantity }],
        paymentAmount: (Number(quantity) * 2).toFixed(2),
        paymentMethod: "CASH",
      });
    const expiredSale = await sale("3");
    assert.equal(expiredSale.ok, false);
    if (!expiredSale.ok) {
      assert.match(expiredSale.message, /past their expiry date/);
    }
    assert.equal(await stock(), "5");
    assert.deepEqual(await lots(), { L1: "0", L2: "0", L3: "2", OLD: "3" });

    // The in-date part sells, and never touches the expired lot.
    assert.equal((await sale("2")).ok, true);
    assert.deepEqual(await lots(), { L1: "0", L2: "0", L3: "0", OLD: "3" });
    assert.equal((await sale("1")).ok, false);

    // Dated before the expiry day, the same stock is still sellable (the last day counts).
    assert.equal((await sale("1", "2026-09-01")).ok, true);
    assert.deepEqual(await lots(), { L1: "0", L2: "0", L3: "0", OLD: "2" });

    // Clearing expired stock (an adjustment) is allowed and takes the earliest expiry first.
    const cleared = await postAdjustment({ ...actor, idempotencyKey: randomUUID(), productId: product.id, quantity: "2", direction: "OUT", reason: "expired" });
    assert.equal(cleared.ok, true);
    assert.deepEqual(await lots(), { L1: "0", L2: "0", L3: "0", OLD: "0" });
    assert.equal(await stock(), "0");
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockBalance.deleteMany({ where: { organizationId: org.id } });
    await prisma.expiryBatch.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockAdjustment.deleteMany({ where: { organizationId: org.id } });
    await prisma.damageRecord.deleteMany({ where: { organizationId: org.id } });
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
