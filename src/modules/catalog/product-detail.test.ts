import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { getProductDetail, savePriceSteps } from "./detail.ts";
import { createProduct, hideCost, updateProduct } from "./products.ts";

// P04 task 3: the product page reads everything about a product at once, the price list follows the product's own prices, a price
// change is audited with the old and the new price, and what the product cost is only shown to someone who may see it (D20).

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const base = (t: T) => ({
  organizationId: t.org.id, actorId: t.owner.id, sku: "SEED-1", name: "Hybrid Seed", purchasePrice: "60.00", sellingPrice: "100.00", wholesalePrice: "90.00", minimumPrice: "70.00",
  trackStock: true, trackExpiry: false, trackSerial: false, reorderLevel: "5", warrantyAvailable: false, ip: "127.0.0.1", userAgent: "test",
});

test("creating a product puts its Retail and Wholesale prices in the price list; changing them changes the list, and the change is audited", async () => {
  await withTestOrg(async (t) => {
    const made = await createProduct(base(t));
    assert.equal(made.ok, true, JSON.stringify(made));
    const id = made.ok ? made.product.id : "";
    const steps = async () => (await prisma.productPrice.findMany({ where: { organizationId: t.org.id, productId: id }, include: { priceLevel: true } })).map((p) => [p.priceLevel.name, p.minQty.toFixed(0), p.price.toFixed(2)]).sort();
    assert.deepEqual(await steps(), [["Retail", "1", "100.00"], ["Wholesale", "1", "90.00"]]);

    const changed = await updateProduct({ ...base(t), productId: id, sellingPrice: "110.00", wholesalePrice: "95.00", genericName: "Imidacloprid" });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    assert.deepEqual(await steps(), [["Retail", "1", "110.00"], ["Wholesale", "1", "95.00"]]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: t.org.id, entityType: "product", action: "update", entityId: id } });
    assert.match(JSON.stringify(audit.before), /"sellingPrice":"100.00"/);
    assert.match(JSON.stringify(audit.after), /"sellingPrice":"110.00"/);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id } })).genericName, "Imidacloprid");
  });
});

test("a service has no stock, expiry or serial whatever the form says", async () => {
  await withTestOrg(async (t) => {
    const made = await createProduct({ ...base(t), sku: "SVC-1", name: "Delivery charge", isService: true, trackStock: true, trackExpiry: true, trackSerial: true });
    assert.equal(made.ok, true, JSON.stringify(made));
    const row = await prisma.product.findUniqueOrThrow({ where: { id: made.ok ? made.product.id : "" } });
    assert.deepEqual([row.isService, row.trackStock, row.trackExpiry, row.trackBatch, row.trackSerial], [true, false, false, false, false]);
  });
});

test("the product page: levels and steps, stock by warehouse, and the cost and margin only with permission", async () => {
  await withTestOrg(async (t) => {
    const stocked = await stockedProduct(t, { units: 20, cost: "60.00", price: "100.00" });
    const steps = await savePriceSteps({ organizationId: t.org.id, actorId: t.owner.id, productId: stocked.id, prices: [
      { level: "Retail", minQty: "1", price: "100.00" }, { level: "Wholesale", minQty: "1", price: "95.00" }, { level: "Wholesale", minQty: "10", price: "90.00" },
    ], ip: "127.0.0.1", userAgent: "test" });
    assert.equal(steps.ok, true, JSON.stringify(steps));

    const full = await getProductDetail(t.org.id, stocked.id, { cost: true });
    assert.deepEqual(full?.levels.find((l) => l.level === "Wholesale")?.steps, [{ minQty: "1.0000", price: "95.00" }, { minQty: "10.0000", price: "90.00" }]);
    assert.deepEqual(full?.stock.map((s) => [s.warehouseName, s.quantity]), [[t.warehouse.name, "20.0000"]]);
    assert.deepEqual([full?.onHand, full?.cost?.averageCost, full?.cost?.stockValue, full?.cost?.marginPercent], ["20.0000", "60.0000", "1200.00", "40.00"]);
    assert.ok(full?.ledger.length, "the stock ledger tab has the movements");

    const cashier = await getProductDetail(t.org.id, stocked.id, { cost: false });
    assert.equal(cashier?.cost, undefined);
    const text = JSON.stringify(cashier);
    for (const secret of ["purchasePrice", "averageCost", "margin", "stockValue", "60.00", "60.0000"]) {
      assert.equal(text.includes(secret), false, `a cashier's page must not carry ${secret}`);
    }
    assert.equal("purchasePrice" in hideCost({ purchasePrice: "1.00", name: "x" }), false);
  });
});

test("a refused price list changes nothing and says why; a good one is audited with the steps before and after", async () => {
  await withTestOrg(async (t) => {
    const stocked = await stockedProduct(t, { units: 1 });
    const who = { organizationId: t.org.id, actorId: t.owner.id, productId: stocked.id, ip: "127.0.0.1", userAgent: "test" };
    assert.equal((await savePriceSteps({ ...who, prices: [{ level: "Retail", minQty: "1", price: "100.00" }] })).ok, true);
    const bad = await savePriceSteps({ ...who, prices: [{ level: "Retail", minQty: "1", price: "abc" }] });
    assert.deepEqual([bad.ok, bad.ok ? 0 : bad.status], [false, 422]);
    assert.equal(await prisma.productPrice.count({ where: { organizationId: t.org.id, productId: stocked.id } }), 1);
    assert.equal((await savePriceSteps({ ...who, prices: [{ level: "Retail", minQty: "1", price: "120.00" }, { level: "Wholesale", minQty: "5", price: "99.00" }] })).ok, true);
    const audits = await prisma.auditLog.findMany({ where: { organizationId: t.org.id, entityType: "product_prices", entityId: stocked.id }, orderBy: { createdAt: "desc" } });
    assert.match(JSON.stringify(audits[0].before), /Retail 1\.0000\+ = 100\.00/);
    assert.match(JSON.stringify(audits[0].after), /Wholesale 5\.0000\+ = 99\.00/);
  });
});
