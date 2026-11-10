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
process.env.AUTH_SECRET ??= "test-secret-variant-price-value";
process.env.BCRYPT_COST = "4";

test("a variant sells at its own price and falls back to the product price", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { postOpeningStock } = await import("../inventory/documents.ts");
  const { postSale } = await import("./sales.ts");

  const stamp = `${Date.now()}-variant`;
  const org = await prisma.organization.create({ data: { name: "Variant price", slug: `variant-price-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Cashier", email: `variant-${stamp}@example.com`, passwordHash: await hashPassword("correct-password") },
  });
  const { ensureChart } = await import("../../core/ledger/chart.ts");
  await ensureChart(prisma, org.id);
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: `V-${stamp}`,
      liveSku: `V-${stamp}`,
      name: "Shirt",
      slug: `shirt-${stamp}`,
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
  const priced = await prisma.productVariant.create({
    data: { organizationId: org.id, productId: product.id, sku: `V-L-${stamp}`, price: "12.50" },
  });
  const unpriced = await prisma.productVariant.create({
    data: { organizationId: org.id, productId: product.id, sku: `V-S-${stamp}`, price: null },
  });
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, warehouseId: warehouse.id, ip: "127.0.0.1", userAgent: "test" };

  try {
    const opened = await postOpeningStock({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [
        { productId: product.id, variantId: priced.id, quantity: "5", unitCost: "5.00" },
        { productId: product.id, variantId: unpriced.id, quantity: "5", unitCost: "5.00" },
      ],
    });
    assert.equal(opened.ok, true);

    const sold = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-02",
      lines: [
        { productId: product.id, variantId: priced.id, quantity: "2" },
        { productId: product.id, variantId: unpriced.id, quantity: "1" },
      ],
      paymentAmount: "35.00",
      paymentMethod: "CASH",
    });
    assert.equal(sold.ok, true);
    const items = await prisma.saleItem.findMany({ where: { organizationId: org.id } });
    const priceOf = (variantId: string) => items.find((item) => item.variantId === variantId)?.unitPrice.toFixed(2);
    assert.equal(priceOf(priced.id), "12.50");
    assert.equal(priceOf(unpriced.id), "10.00");

    // The product price is not accepted for a variant that has its own price.
    const wrong = await postSale({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-02",
      lines: [{ productId: product.id, variantId: priced.id, quantity: "1", unitPrice: "10.00" }],
      paymentAmount: "10.00",
      paymentMethod: "CASH",
    });
    assert.equal(wrong.ok, false);
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
