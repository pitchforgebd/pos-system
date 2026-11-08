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
process.env.AUTH_SECRET ??= "test-secret-phase-05-value";
process.env.BCRYPT_COST = "4";

test("phase 05 stock and products", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { createProduct, disableProduct, getProduct } = await import("../catalog/products.ts");
  const { postAdjustment, postOpeningStock } = await import("./documents.ts");
  const { ledgerMatchesBalance, listStock } = await import("./stock.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Stock A", slug: `stock-a-${stamp}` } });
  const other = await prisma.organization.create({ data: { name: "Stock B", slug: `stock-b-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Keeper",
      email: `keeper-${stamp}@example.com`,
      passwordHash: await hashPassword("correct-password"),
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
    const created = await createProduct({
      ...actor,
      actorId: user.id,
      sku: `SKU-${stamp}`,
      name: `Rice ${stamp}`,
      purchasePrice: "10.00",
      sellingPrice: "15.00",
      wholesalePrice: "12.00",
      minimumPrice: "11.00",
      trackStock: true,
      trackExpiry: false,
      trackBatch: false,
      trackSerial: false,
      reorderLevel: "5",
      warrantyAvailable: false,
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal(await getProduct(other.id, created.product.id), null);

    const opened = await postOpeningStock({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: created.product.id, quantity: "2.0000", unitCost: "10.00" }],
    });
    assert.equal(opened.ok, true);
    const low = await listStock({ organizationId: org.id, branchId: branch.id });
    assert.equal(low[0]?.quantity, "2.0000");
    assert.equal(low[0]?.alert, "LOW");

    const tooMuch = await postAdjustment({
      ...actor,
      idempotencyKey: randomUUID(),
      productId: created.product.id,
      quantity: "3",
      direction: "OUT",
      reason: "count",
    });
    assert.equal(tooMuch.ok, false);
    if (!tooMuch.ok) {
      assert.equal(tooMuch.status, 422);
    }
    const still = await listStock({ organizationId: org.id, branchId: branch.id });
    assert.equal(still[0]?.quantity, "2.0000");

    const key = randomUUID();
    const first = await postAdjustment({
      ...actor,
      idempotencyKey: key,
      productId: created.product.id,
      quantity: "1",
      direction: "OUT",
      reason: "count",
    });
    const replay = await postAdjustment({
      ...actor,
      idempotencyKey: key,
      productId: created.product.id,
      quantity: "1",
      direction: "OUT",
      reason: "count",
    });
    assert.equal(first.ok, true);
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.replayed, true);
    }
    const afterReplay = await listStock({ organizationId: org.id, branchId: branch.id });
    assert.equal(afterReplay[0]?.quantity, "1.0000");

    const mismatch = await postAdjustment({
      ...actor,
      idempotencyKey: key,
      productId: created.product.id,
      quantity: "1",
      direction: "IN",
      reason: "count",
    });
    assert.equal(mismatch.ok, false);

    const last = await postOpeningStock({
      ...actor,
      idempotencyKey: randomUUID(),
      businessDate: "2026-10-01",
      lines: [{ productId: created.product.id, quantity: "1" }],
    });
    assert.equal(last.ok, true);
    const raced = await Promise.all([
      postAdjustment({
        ...actor,
        idempotencyKey: randomUUID(),
        productId: created.product.id,
        quantity: "2",
        direction: "OUT",
        reason: "race",
      }),
      postAdjustment({
        ...actor,
        idempotencyKey: randomUUID(),
        productId: created.product.id,
        quantity: "2",
        direction: "OUT",
        reason: "race",
      }),
    ]);
    const wins = raced.filter((result) => result.ok).length;
    assert.equal(wins, 1);
    const finalStock = await listStock({ organizationId: org.id, branchId: branch.id });
    assert.equal(finalStock[0]?.quantity, "0.0000");
    assert.equal(finalStock[0]?.alert, "OUT_OF_STOCK");
    assert.equal(await ledgerMatchesBalance(org.id, branch.id), true);

    const removed = await disableProduct({
      organizationId: org.id,
      actorId: user.id,
      productId: created.product.id,
      ip: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal(removed.ok, true);
    assert.equal(await getProduct(org.id, created.product.id), null);
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    for (const id of [org.id, other.id]) {
      await cleanupOrg(id);
    }
    await prisma.$disconnect();
  }
});
