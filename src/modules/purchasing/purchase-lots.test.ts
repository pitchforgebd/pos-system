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
process.env.AUTH_SECRET ??= "test-secret-purchase-lots-value";
process.env.BCRYPT_COST = "4";

test("a purchase of an expiry-tracked product creates its lots", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("../auth/password.ts");
  const { postPurchase } = await import("./purchases.ts");
  const { createSupplier } = await import("./suppliers.ts");

  const stamp = `${Date.now()}-pl`;
  const org = await prisma.organization.create({ data: { name: "Purchase lots", slug: `purchase-lots-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Buyer", email: `pl-${stamp}@example.com`, passwordHash: await hashPassword("correct-password") },
  });
  const asset = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "1000", name: "Assets" } });
  const liability = await prisma.accountGroup.create({ data: { organizationId: org.id, code: "2000", name: "Liabilities" } });
  await prisma.account.createMany({
    data: [
      { organizationId: org.id, groupId: asset.id, code: "1100", name: "Cash" },
      { organizationId: org.id, groupId: asset.id, code: "1200", name: "Bank" },
      { organizationId: org.id, groupId: asset.id, code: "1400", name: "Inventory" },
      { organizationId: org.id, groupId: liability.id, code: "2100", name: "Accounts Payable" },
    ],
  });
  async function product(code: string, trackExpiry: boolean) {
    return prisma.product.create({
      data: {
        organizationId: org.id,
        sku: `${code}-${stamp}`,
        liveSku: `${code}-${stamp}`,
        name: code,
        slug: `${code}-${stamp}`.toLowerCase(),
        purchasePrice: "5.00",
        sellingPrice: "8.00",
        wholesalePrice: "8.00",
        minimumPrice: "5.00",
        trackStock: true,
        trackExpiry,
        trackBatch: false,
        trackSerial: false,
      },
    });
  }
  const actor = { organizationId: org.id, branchId: branch.id, userId: user.id, warehouseId: warehouse.id, ip: "127.0.0.1", userAgent: "test" };

  try {
    const supplier = await createSupplier({
      organizationId: org.id,
      actorId: user.id,
      name: "Dairy",
      openingPayable: "0.00",
      creditLimit: "1000.00",
      ip: "127.0.0.1",
      userAgent: "test",
    });
    assert.equal(supplier.ok, true);
    if (!supplier.ok) {
      return;
    }
    const milk = await product("MILK", true);
    const salt = await product("SALT", false);
    const buy = (lines: Parameters<typeof postPurchase>[0]["lines"]) =>
      postPurchase({ ...actor, idempotencyKey: randomUUID(), supplierId: supplier.supplier.id, businessDate: "2026-10-01", lines });

    // An expiry-tracked product needs a lot and an expiry date; nothing is posted without them.
    const bare = await buy([{ productId: milk.id, quantity: "4", unitCost: "5.00" }]);
    assert.equal(bare.ok, false);
    const badDate = await buy([{ productId: milk.id, quantity: "4", unitCost: "5.00", lot: "M1", expiresOn: "2026-02-31" }]);
    assert.equal(badDate.ok, false);
    assert.equal(await prisma.purchase.count({ where: { organizationId: org.id } }), 0);
    assert.equal(await prisma.expiryBatch.count({ where: { organizationId: org.id } }), 0);

    const first = await buy([{ productId: milk.id, quantity: "4", unitCost: "5.00", lot: "M1", manufacturedOn: "2026-09-20", expiresOn: "2026-10-20" }]);
    assert.equal(first.ok, true);
    const lotOf = async () => {
      const rows = await prisma.expiryBatch.findMany({ where: { organizationId: org.id, productId: milk.id }, orderBy: { lot: "asc" } });
      return rows.map((row) => `${row.lot}:${row.expiresOn.toISOString().slice(0, 10)}:${row.quantity.toFixed(0)}`);
    };
    assert.deepEqual(await lotOf(), ["M1:2026-10-20:4"]);

    // The same lot and expiry again tops the lot up; another lot is a new row.
    assert.equal((await buy([{ productId: milk.id, quantity: "2", unitCost: "5.00", lot: "M1", expiresOn: "2026-10-20" }])).ok, true);
    assert.equal((await buy([{ productId: milk.id, quantity: "3", unitCost: "5.00", lot: "M2", expiresOn: "2026-11-20" }])).ok, true);
    assert.deepEqual(await lotOf(), ["M1:2026-10-20:6", "M2:2026-11-20:3"]);
    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: org.id, productId: milk.id } });
    assert.equal(balance.quantity.toFixed(0), "9");

    // A product that does not expire ignores the lot fields' absence.
    assert.equal((await buy([{ productId: salt.id, quantity: "5", unitCost: "5.00" }])).ok, true);
    assert.equal(await prisma.expiryBatch.count({ where: { organizationId: org.id, productId: salt.id } }), 0);
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
