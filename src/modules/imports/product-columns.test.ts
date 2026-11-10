import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { confirmProductImport, exportProducts } from "./product-import.ts";

// P04 task 9: the product file carries the generic name, VAT, whether it is a service, and the dealer price; a file exported without the
// right to see costs has no cost column values and still imports.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const run = (t: T, csv: string) => confirmProductImport({ organizationId: t.org.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test", idempotencyKey: randomUUID(), fileName: "products.csv", csv });
const HEAD = "sku,name,purchasePrice,sellingPrice,wholesalePrice,minimumPrice,reorderLevel,barcode,genericName,vatType,vatRate,isService,dealerPrice";

test("the new columns reach the product: generic name, VAT, service, and the dealer level price", async () => {
  await withTestOrg(async (t) => {
    const done = await run(t, `${HEAD}\nUREA-50,Urea 50kg,1800.00,2000.00,1950.00,1700.00,10,8901,Urea 46% N,EXCLUSIVE,5.00,no,1900.00\nDEL-1,Delivery,0.00,50.00,50.00,10.00,0,,,,,yes,\n`);
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.deepEqual(done.ok ? [done.success, done.failed] : [], [2, 0]);
    const urea = await prisma.product.findFirstOrThrow({ where: { organizationId: t.org.id, sku: "UREA-50" } });
    assert.deepEqual([urea.genericName, urea.vatType, urea.vatValue?.toFixed(2), urea.isService, urea.trackStock], ["Urea 46% N", "EXCLUSIVE", "5.00", false, true]);
    const prices = (await prisma.productPrice.findMany({ where: { organizationId: t.org.id, productId: urea.id }, include: { priceLevel: true } })).map((p) => [p.priceLevel.name, p.price.toFixed(2)]).sort();
    assert.deepEqual(prices, [["Dealer", "1900.00"], ["Retail", "2000.00"], ["Wholesale", "1950.00"]]);
    const delivery = await prisma.product.findFirstOrThrow({ where: { organizationId: t.org.id, sku: "DEL-1" } });
    assert.deepEqual([delivery.isService, delivery.trackStock], [true, false], "a service has no stock");
  });
});

test("a bad VAT, service or dealer cell fails its row and nothing else", async () => {
  await withTestOrg(async (t) => {
    const done = await run(t, `${HEAD}\nA,A,1,2,2,1,0,,,SOMETIMES,5,no,\nB,B,1,2,2,1,0,,,INCLUSIVE,,no,\nC,C,1,2,2,1,0,,,,,maybe,\nD,D,1,2,2,1,0,,,,,no,cheap\nE,E,1,2,2,1,0,,,,,no,\n`);
    assert.equal(done.ok, true);
    assert.deepEqual(done.ok ? done.rows.map((r) => r.status) : [], ["FAILED", "FAILED", "FAILED", "FAILED", "IMPORTED"]);
    assert.equal(await prisma.product.count({ where: { organizationId: t.org.id } }), 1);
  });
});

test("the export has the new columns and reads back; without the right to see costs the cost column is blank", async () => {
  await withTestOrg(async (t) => {
    await run(t, `${HEAD}\nUREA-50,Urea 50kg,1800.00,2000.00,1950.00,1700.00,10,8901,Urea 46% N,EXCLUSIVE,5.00,no,1900.00\n`);
    const full = await exportProducts(t.org.id, { includeCost: true });
    assert.equal(full.ok, true);
    const lines = full.ok ? full.csv.trim().split(/\r?\n/) : [];
    assert.equal(lines[0], HEAD);
    assert.equal(lines[1], "UREA-50,Urea 50kg,1800.00,2000.00,1950.00,1700.00,10.0000,8901,Urea 46% N,EXCLUSIVE,5.00,no,1900.00");

    const hidden = await exportProducts(t.org.id, { includeCost: false });
    const hiddenLine = hidden.ok ? hidden.csv.trim().split(/\r?\n/)[1] : "";
    assert.equal(hiddenLine.split(",")[2], "", "no cost for someone who may not see it");
    assert.equal(hiddenLine.includes("1800.00"), false);

    // that file imports into another organization (an unknown cost is 0.00)
    await withTestOrg(async (other) => {
      const back = await run(other, hidden.ok ? hidden.csv : "");
      assert.equal(back.ok, true, JSON.stringify(back));
      assert.deepEqual(back.ok ? [back.success, back.failed] : [], [1, 0]);
      const row = await prisma.product.findFirstOrThrow({ where: { organizationId: other.org.id, sku: "UREA-50" } });
      assert.deepEqual([row.purchasePrice.toFixed(2), row.sellingPrice.toFixed(2), row.genericName], ["0.00", "2000.00", "Urea 46% N"]);
    });
  });
});

test("the old header still works", async () => {
  await withTestOrg(async (t) => {
    const done = await run(t, "sku,name,purchasePrice,sellingPrice,wholesalePrice,minimumPrice\nOLD-1,Old,1.00,2.00,2.00,1.00\n");
    assert.deepEqual(done.ok ? [done.success, done.failed] : [], [1, 0]);
  });
});
