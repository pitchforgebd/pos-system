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

test("phase 15 imports each row on its own and posts the opening stock as one journal", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { parseCsv } = await import("./csv.ts");
  const { confirmOpeningImport } = await import("./opening-import.ts");
  const { confirmProductImport, exportProducts, previewProductCsv } = await import("./product-import.ts");

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Import A", slug: `import-a-${stamp}` } });
  await (await import("../../core/ledger/chart.ts")).ensureChart(prisma, org.id);
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Importer", email: `importer-${stamp}@example.com`, passwordHash: "not-used" },
  });
  const actor = { organizationId: org.id, userId: user.id, ip: "127.0.0.1", userAgent: "test" };
  const sku = `CSV-${stamp}`;

  try {
    const header = previewProductCsv("foo,bar\n1,2\n");
    assert.equal(header.ok, false);
    assert.equal(await prisma.product.count({ where: { organizationId: org.id } }), 0);

    const quoted = parseCsv('sku,name\n"A,1","Tea, loose"\n');
    assert.equal(quoted.rows[0]?.[0], "A,1");
    assert.equal(quoted.rows[0]?.[1], "Tea, loose");

    const csv = [
      "sku,name,purchasePrice,sellingPrice,wholesalePrice,minimumPrice,reorderLevel,barcode",
      `${sku},Tea,1.00,2.00,1.50,1.00,0,BC-${stamp}`,
      ",Missing,1.00,2.00,1.50,1.00,0,",
    ].join("\n");
    const imported = await confirmProductImport({ ...actor, idempotencyKey: randomUUID(), fileName: "products.csv", csv });
    assert.equal(imported.ok, true);
    if (imported.ok) {
      assert.equal(imported.success, 1);
      assert.equal(imported.failed, 1);
    }
    const repeat = await confirmProductImport({
      ...actor,
      idempotencyKey: randomUUID(),
      fileName: "products.csv",
      csv: `sku,name,purchasePrice,sellingPrice,wholesalePrice,minimumPrice\n${sku},Tea,1.00,2.00,1.50,1.00\n`,
    });
    assert.equal(repeat.ok, true);
    if (repeat.ok) {
      assert.equal(repeat.skipped, 1);
      assert.equal(repeat.success, 0);
    }
    assert.equal(await prisma.product.count({ where: { organizationId: org.id } }), 1);

    const journalsBefore = await prisma.journal.count({ where: { organizationId: org.id } });
    const opening = await confirmOpeningImport({
      ...actor,
      branchId: branch.id,
      warehouseId: warehouse.id,
      idempotencyKey: randomUUID(),
      fileName: "opening.csv",
      businessDate: "2026-10-01",
      csv: `sku,quantity,unitCost,rack\n${sku},2,3.00,Shelf\nMISSING,1,1.00,\n`,
    });
    assert.equal(opening.ok, true);
    if (opening.ok) {
      assert.equal(opening.successRows, 1);
      assert.equal(opening.failedRows, 1);
    }
    const balance = await prisma.stockBalance.findFirst({ where: { organizationId: org.id, product: { sku } } });
    assert.equal(balance?.quantity.toFixed(4), "2.0000");
    assert.equal(await prisma.journal.count({ where: { organizationId: org.id } }), journalsBefore + 1, "one opening-stock document, one journal (Dr Inventory / Cr Opening Balance Equity)");

    const exported = await exportProducts(org.id);
    assert.equal(exported.ok, true);
    if (exported.ok) {
      assert.match(exported.csv, new RegExp(`^sku,name,purchasePrice`));
      assert.match(exported.csv, new RegExp(sku));
    }
  } finally {
    const { cleanupOrg } = await import("../../tests/helpers/cleanup.ts");
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  }
});
