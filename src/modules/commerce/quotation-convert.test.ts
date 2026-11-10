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
  const { ensureChart } = await import("../../core/ledger/chart.ts");
  await ensureChart(prisma, org.id);
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
    // I2: every receivable and payable line these postings wrote names its party.
    const { partyLineViolations } = await import("../../core/posting/invariants.ts");
    assert.deepEqual(await partyLineViolations(prisma, org.id), []);
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
