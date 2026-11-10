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
process.env.AUTH_SECRET ??= "test-secret-phase-02-value";
process.env.BCRYPT_COST = "4";

test("damage and expiry write-off are idempotent", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { createProduct } = await import("../catalog/products.ts");
  const { postDamage, postOpeningStock, writeOffExpiry } = await import("./documents.ts");
  const { listStock } = await import("./stock.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Idem", slug: `idem-${stamp}` } });
  await (await import("../../core/ledger/chart.ts")).ensureChart(prisma, org.id);
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Keeper",
      email: `idem-${stamp}@example.com`,
      passwordHash: await hashPassword("correct-password"),
    },
  });
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, warehouseId: warehouse.id, ip: "127.0.0.1", userAgent: "test" };

  async function product(suffix: string, trackExpiry: boolean) {
    const created = await createProduct({
      ...actor,
      actorId: user.id,
      sku: `IDEM-${suffix}-${stamp}`,
      name: `Item ${suffix} ${stamp}`,
      purchasePrice: "10.00",
      sellingPrice: "15.00",
      wholesalePrice: "12.00",
      minimumPrice: "11.00",
      trackStock: true,
      trackExpiry,
      trackBatch: false,
      trackSerial: false,
      reorderLevel: "1",
      warrantyAvailable: false,
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      throw new Error("product was not created");
    }
    return created.product.id;
  }

  async function quantityOf(productId: string) {
    const rows = await listStock({ organizationId: org.id, branchId: branch.id });
    return rows.find((row) => row.productId === productId)?.quantity;
  }

  try {
    const plain = await product("A", false);
    const expiring = await product("B", true);
    for (const line of [
      { productId: plain, quantity: "10" },
      { productId: expiring, quantity: "10", lot: "L1", expiresOn: "2026-12-31" },
    ]) {
      const opened = await postOpeningStock({ ...actor, idempotencyKey: randomUUID(), businessDate: "2026-10-01", lines: [line] });
      assert.equal(opened.ok, true);
    }

    const damage = {
      ...actor,
      productId: plain,
      businessDate: "2026-10-02",
      place: "Shelf",
      purchasePrice: "10.00",
      salePrice: "15.00",
      discountAmount: "0.00",
      vatAmount: "0.00",
      quantity: "2",
      reason: "broken",
    };
    const key = randomUUID();
    const first = await postDamage({ ...damage, idempotencyKey: key });
    const replay = await postDamage({ ...damage, idempotencyKey: key });
    assert.equal(first.ok, true);
    assert.equal(replay.ok, true);
    if (first.ok && replay.ok) {
      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.id, first.id);
    }
    assert.equal(await prisma.stockDocument.count({ where: { organizationId: org.id, type: "DAMAGE" } }), 1);
    assert.equal(await quantityOf(plain), "8.0000");

    const different = await postDamage({ ...damage, quantity: "3", idempotencyKey: key });
    assert.equal(different.ok, false);
    if (!different.ok) {
      assert.equal(different.status, 409);
      assert.equal(different.code, "CONFLICT");
    }
    assert.equal(await quantityOf(plain), "8.0000");

    const raceKey = randomUUID();
    const raced = await Promise.all([
      postDamage({ ...damage, idempotencyKey: raceKey }),
      postDamage({ ...damage, idempotencyKey: raceKey }),
    ]);
    assert.deepEqual(
      raced.map((result) => result.ok),
      [true, true],
    );
    assert.equal(raced.filter((result) => result.ok && result.replayed).length, 1);
    assert.equal(await prisma.stockDocument.count({ where: { organizationId: org.id, type: "DAMAGE" } }), 2);
    assert.equal(await quantityOf(plain), "6.0000");

    const batch = await prisma.expiryBatch.findFirstOrThrow({ where: { organizationId: org.id, productId: expiring } });
    const offKey = randomUUID();
    const off = await writeOffExpiry({ ...actor, idempotencyKey: offKey, batchId: batch.id, quantity: "3" });
    const offReplay = await writeOffExpiry({ ...actor, idempotencyKey: offKey, batchId: batch.id, quantity: "3" });
    assert.equal(off.ok, true);
    assert.equal(offReplay.ok, true);
    if (off.ok && offReplay.ok) {
      assert.equal(off.replayed, false);
      assert.equal(offReplay.replayed, true);
      assert.equal(offReplay.quantity, "7.0000");
    }
    assert.equal(await quantityOf(expiring), "7.0000");
    const remaining = await prisma.expiryBatch.findUniqueOrThrow({ where: { id: batch.id } });
    assert.equal(remaining.quantity.toFixed(4), "7.0000");

    const offDifferent = await writeOffExpiry({ ...actor, idempotencyKey: offKey, batchId: batch.id, quantity: "4" });
    assert.equal(offDifferent.ok, false);
    if (!offDifferent.ok) {
      assert.equal(offDifferent.status, 409);
    }
    assert.equal(await quantityOf(expiring), "7.0000");
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
