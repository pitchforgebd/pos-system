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
process.env.AUTH_SECRET ??= "test-secret-transfer-value";
process.env.BCRYPT_COST = "4";

test("a transfer is received at once, keeps cost and lots, and is idempotent", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { postOpeningStock, postTransfer } = await import("./documents.ts");
  const { ledgerMatchesBalance } = await import("./stock.ts");

  const stamp = `${Date.now()}-trf`;
  const org = await prisma.organization.create({ data: { name: "Transfer", slug: `transfer-${stamp}` } });
  const north = await prisma.branch.create({ data: { organizationId: org.id, name: "North" } });
  const south = await prisma.branch.create({ data: { organizationId: org.id, name: "South" } });
  const northStore = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: north.id, name: "Store" } });
  const southStore = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: south.id, name: "Store" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Keeper", email: `trf-${stamp}@example.com`, passwordHash: await hashPassword("correct-password") },
  });
  async function product(code: string, trackExpiry: boolean) {
    return prisma.product.create({
      data: {
        organizationId: org.id,
        sku: `${code}-${stamp}`,
        liveSku: `${code}-${stamp}`,
        name: code,
        slug: `${code}-${stamp}`.toLowerCase(),
        purchasePrice: "1.00",
        sellingPrice: "2.00",
        wholesalePrice: "2.00",
        minimumPrice: "1.00",
        trackStock: true,
        trackExpiry,
        trackBatch: false,
        trackSerial: false,
      },
    });
  }
  const at = (branch: { id: string }, warehouse: { id: string }) => ({
    organizationId: org.id,
    branchId: branch.id,
    warehouseId: warehouse.id,
    userId: user.id,
    ip: "127.0.0.1",
    userAgent: "test",
  });
  const transferBase = {
    organizationId: org.id,
    userId: user.id,
    fromBranchId: north.id,
    toBranchId: south.id,
    fromWarehouseId: northStore.id,
    toWarehouseId: southStore.id,
    ip: "127.0.0.1",
    userAgent: "test",
  };
  async function balance(productId: string, branchId: string, variantId: string | null = null) {
    return prisma.stockBalance.findFirst({ where: { organizationId: org.id, productId, branchId, variantId } });
  }

  try {
    const plain = await product("PLAIN", false);
    const perishable = await product("PERISH", true);
    const sized = await product("SIZED", false);
    const variant = await prisma.productVariant.create({ data: { organizationId: org.id, productId: sized.id, sku: `SIZED-L-${stamp}` } });

    const open = (where: ReturnType<typeof at>, lines: Parameters<typeof postOpeningStock>[0]["lines"]) =>
      postOpeningStock({ ...where, idempotencyKey: randomUUID(), businessDate: "2026-10-01", lines });
    assert.equal((await open(at(north, northStore), [{ productId: plain.id, quantity: "10", unitCost: "10.00" }])).ok, true);
    assert.equal((await open(at(south, southStore), [{ productId: plain.id, quantity: "10", unitCost: "20.00" }])).ok, true);
    assert.equal(
      (
        await open(at(north, northStore), [
          { productId: perishable.id, quantity: "5", unitCost: "3.00", lot: "L1", expiresOn: "2026-11-01" },
          { productId: perishable.id, quantity: "5", unitCost: "3.00", lot: "L2", expiresOn: "2026-12-01" },
        ])
      ).ok,
      true,
    );
    assert.equal((await open(at(north, northStore), [{ productId: sized.id, variantId: variant.id, quantity: "6", unitCost: "4.00" }])).ok, true);

    // Cost: 5 units at 10.00 land on 10 units at 20.00 -> (10*20 + 5*10) / 15.
    const key = randomUUID();
    const first = await postTransfer({ ...transferBase, idempotencyKey: key, lines: [{ productId: plain.id, quantity: "5" }] });
    assert.equal(first.ok, true);
    if (!first.ok) {
      return;
    }
    assert.match(first.number ?? "", /^TRF-\d{4}-000001$/);
    assert.equal((await balance(plain.id, north.id))?.quantity.toFixed(4), "5.0000");
    assert.equal((await balance(plain.id, south.id))?.quantity.toFixed(4), "15.0000");
    assert.equal((await balance(plain.id, south.id))?.averageCost?.toFixed(4), "16.6667");
    assert.equal((await balance(plain.id, north.id))?.averageCost?.toFixed(4), "10.0000");
    const stored = await prisma.stockTransfer.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(stored.status, "RECEIVED");

    // The same key again changes nothing; the same key with other lines is refused.
    const replay = await postTransfer({ ...transferBase, idempotencyKey: key, lines: [{ productId: plain.id, quantity: "5" }] });
    assert.equal(replay.ok && replay.replayed, true);
    assert.equal(replay.ok && replay.id, first.id);
    assert.equal((await balance(plain.id, south.id))?.quantity.toFixed(4), "15.0000");
    const clash = await postTransfer({ ...transferBase, idempotencyKey: key, lines: [{ productId: plain.id, quantity: "1" }] });
    assert.equal(clash.ok, false);
    assert.equal(await prisma.stockTransfer.count({ where: { organizationId: org.id } }), 1);

    // More than the source holds: refused, nothing moves.
    const tooMuch = await postTransfer({ ...transferBase, idempotencyKey: randomUUID(), lines: [{ productId: plain.id, quantity: "6" }] });
    assert.equal(tooMuch.ok, false);
    assert.equal((await balance(plain.id, north.id))?.quantity.toFixed(4), "5.0000");
    assert.equal(await prisma.stockTransfer.count({ where: { organizationId: org.id } }), 1);

    // Lots travel with the goods: earliest expiry leaves first and is recreated at the destination.
    const lots = await postTransfer({ ...transferBase, idempotencyKey: randomUUID(), lines: [{ productId: perishable.id, quantity: "7" }] });
    assert.equal(lots.ok, true);
    const lotsAt = async (branchId: string) => {
      const rows = await prisma.expiryBatch.findMany({ where: { organizationId: org.id, productId: perishable.id, branchId }, orderBy: { lot: "asc" } });
      return Object.fromEntries(rows.map((row) => [row.lot, row.quantity.toFixed(0)]));
    };
    assert.deepEqual(await lotsAt(north.id), { L1: "0", L2: "3" });
    assert.deepEqual(await lotsAt(south.id), { L1: "5", L2: "2" });

    // A variant moves as that variant.
    const variantMove = await postTransfer({
      ...transferBase,
      idempotencyKey: randomUUID(),
      lines: [{ productId: sized.id, variantId: variant.id, quantity: "2" }],
    });
    assert.equal(variantMove.ok, true);
    assert.equal((await balance(sized.id, north.id, variant.id))?.quantity.toFixed(4), "4.0000");
    assert.equal((await balance(sized.id, south.id, variant.id))?.quantity.toFixed(4), "2.0000");

    assert.equal(await ledgerMatchesBalance(org.id, north.id), true);
    assert.equal(await ledgerMatchesBalance(org.id, south.id), true);
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
