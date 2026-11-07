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

test("an opening-stock import posts one document for all valid rows", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { confirmOpeningImport } = await import("./opening-import.ts");

  const stamp = `${Date.now()}-oi`;
  const org = await prisma.organization.create({ data: { name: "Opening import", slug: `opening-import-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Importer", email: `oi-${stamp}@example.com`, passwordHash: "not-used" },
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

  try {
    const first = await product("A", false);
    const second = await product("B", false);
    const perishable = await product("C", true);
    const csv = [
      "sku,quantity,unitCost,lot,expiresOn",
      `${first.sku},3,1.00,,`,
      `${second.sku},4,1.50,,`,
      `${perishable.sku},5,1.00,,`, // expiry-tracked without a lot: fails on its own
      `NOPE-${stamp},1,1.00,,`, // unknown SKU: fails on its own
    ].join("\n");
    const base = {
      organizationId: org.id,
      branchId: branch.id,
      userId: user.id,
      warehouseId: warehouse.id,
      fileName: "opening.csv",
      businessDate: "2026-10-01",
      csv,
      ip: "127.0.0.1",
      userAgent: "test",
    };
    const key = randomUUID();
    const result = await confirmOpeningImport({ ...base, idempotencyKey: key });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.successRows, 2);
    assert.equal(result.failedRows, 2);
    assert.deepEqual(
      result.rows.map((row) => row.status),
      ["IMPORTED", "IMPORTED", "FAILED", "FAILED"],
    );
    assert.equal(await prisma.openingStock.count({ where: { organizationId: org.id } }), 1);
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: org.id } }), 2);

    const replay = await confirmOpeningImport({ ...base, idempotencyKey: key });
    assert.equal(replay.ok && replay.replayed, true);
    assert.equal(await prisma.openingStock.count({ where: { organizationId: org.id } }), 1);
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: org.id } }), 2);
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.idempotencyKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.importRow.deleteMany({ where: { organizationId: org.id } });
    await prisma.import.deleteMany({ where: { organizationId: org.id } });
    await prisma.expiryBatch.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockBalance.deleteMany({ where: { organizationId: org.id } });
    await prisma.openingStock.deleteMany({ where: { organizationId: org.id } });
    await prisma.product.deleteMany({ where: { organizationId: org.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.branch.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
