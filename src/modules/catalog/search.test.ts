import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { searchCustomers } from "../customers/search.ts";
import { ensurePriceLevels, setPrices } from "../pricing/index.ts";
import { factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { searchProducts } from "./search.ts";

// P04 task 7 (N8): the product and customer search answers from the database, 20 rows at a time, so the register no longer loads 200
// products and looks in them. It finds by name, SKU, barcode and generic name, and answers with the price at the level and what is available.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

async function thousand(t: T) {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    organizationId: t.org.id, sku: `BULK-${String(i + 1).padStart(4, "0")}`, liveSku: `BULK-${String(i + 1).padStart(4, "0")}`,
    name: i === 500 ? "Zinc Sulphate 33%" : `Bulk item ${String(i + 1).padStart(4, "0")}`, slug: `bulk-${i + 1}`,
    purchasePrice: "5", sellingPrice: "9", wholesalePrice: "8", minimumPrice: "4", trackStock: true, trackExpiry: false, trackBatch: false, trackSerial: false,
    genericName: i === 700 ? "Chlorpyrifos 20% EC" : null,
  }));
  await prisma.product.createMany({ data: rows });
}

test("the 501st of a thousand products is found by name, SKU and barcode, not just the first 200", async () => {
  await withTestOrg(async (t) => {
    await thousand(t);
    const target = await prisma.product.findFirstOrThrow({ where: { organizationId: t.org.id, name: "Zinc Sulphate 33%" } });
    await prisma.productBarcode.create({ data: { organizationId: t.org.id, productId: target.id, barcode: "8901234567890" } });

    const byName = await searchProducts({ organizationId: t.org.id, q: "zinc sul" });
    assert.deepEqual(byName.map((r) => r.name), ["Zinc Sulphate 33%"]);
    const bySku = await searchProducts({ organizationId: t.org.id, q: "BULK-0501" });
    assert.equal(bySku[0]?.id, target.id);
    const byBarcode = await searchProducts({ organizationId: t.org.id, q: "8901234567890" });
    assert.deepEqual(byBarcode.map((r) => r.id), [target.id], "a scanned barcode finds exactly its product");
    const byGeneric = await searchProducts({ organizationId: t.org.id, q: "chlorpyrifos" });
    assert.deepEqual(byGeneric.map((r) => r.sku), ["BULK-0701"]);
    assert.deepEqual(await searchProducts({ organizationId: t.org.id, q: "no such thing" }), []);
    assert.deepEqual(await searchProducts({ organizationId: t.org.id, q: "  " }), []);
  });
});

test("at most 20 rows, in name order; a switched-off or deleted product is not offered", async () => {
  await withTestOrg(async (t) => {
    await thousand(t);
    const rows = await searchProducts({ organizationId: t.org.id, q: "Bulk item" });
    assert.equal(rows.length, 20);
    assert.deepEqual(rows.slice(0, 2).map((r) => r.name), ["Bulk item 0001", "Bulk item 0002"]);
    await prisma.product.updateMany({ where: { organizationId: t.org.id, sku: "BULK-0001" }, data: { status: "INACTIVE" } });
    await prisma.product.updateMany({ where: { organizationId: t.org.id, sku: "BULK-0002" }, data: { deletedAt: new Date() } });
    assert.equal((await searchProducts({ organizationId: t.org.id, q: "Bulk item" }))[0].name, "Bulk item 0003");
  });
});

test("the price comes at the level asked, or the customer type's, with the quantity steps; the available quantity is what is not reserved", async () => {
  await withTestOrg(async (t) => {
    const levels = await ensurePriceLevels(prisma, t.org.id);
    const product = await stockedProduct(t, { units: 30, price: "100.00", product: { name: "Urea 50kg" } });
    await setPrices(prisma, { organizationId: t.org.id, productId: product.id, prices: [
      { level: "Retail", minQty: "1", price: "100.00" }, { level: "Wholesale", minQty: "1", price: "95.00" }, { level: "Wholesale", minQty: "10", price: "90.00" }, { level: "Dealer", minQty: "1", price: "85.00" },
    ] });
    await prisma.stockBalance.updateMany({ where: { organizationId: t.org.id, productId: product.id }, data: { reservedQty: "5" } });
    const dealerType = await prisma.customerType.create({ data: { organizationId: t.org.id, name: "Dealers", priceLevelId: levels.byName.get("Dealer")?.id } });

    const retail = (await searchProducts({ organizationId: t.org.id, branchId: t.branch.id, q: "urea" }))[0];
    assert.deepEqual([retail.price, retail.levelName, retail.available], ["100.00", "Retail", "25.0000"]);
    const wholesale = (await searchProducts({ organizationId: t.org.id, q: "urea", level: "Wholesale" }))[0];
    assert.deepEqual([wholesale.price, wholesale.steps], ["95.00", [{ minQty: "1", price: "95.00" }, { minQty: "10", price: "90.00" }]]);
    const dealer = (await searchProducts({ organizationId: t.org.id, q: "urea", customerTypeId: dealerType.id }))[0];
    assert.deepEqual([dealer.price, dealer.levelName], ["85.00", "Dealer"]);
    await assert.rejects(searchProducts({ organizationId: t.org.id, q: "urea", level: "Nope" }), /level/i);
  });
});

test("a service is offered with no stock figure, and no answer carries what a product cost", async () => {
  await withTestOrg(async (t) => {
    await factories(t).product({ name: "Delivery charge", sku: "SVC", slug: "svc", isService: true, trackStock: false, sellingPrice: "50.00", purchasePrice: "20.00" });
    const [row] = await searchProducts({ organizationId: t.org.id, q: "delivery" });
    assert.deepEqual([row.isService, row.available, row.price], [true, null, "50.00"]);
    const text = JSON.stringify(row);
    for (const secret of ["purchasePrice", "averageCost", "20.00", "margin"]) {
      assert.equal(text.includes(secret), false, secret);
    }
  });
});

test("variants come with their own price and barcodes", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ name: "Seed pack", sku: "SEEDP", slug: "seedp", sellingPrice: "100.00" });
    const variant = await prisma.productVariant.create({ data: { organizationId: t.org.id, productId: product.id, sku: "SEEDP-5", price: "480.00" } });
    await prisma.productBarcode.create({ data: { organizationId: t.org.id, productId: product.id, variantId: variant.id, barcode: "VARIANT-CODE-5" } });
    const bySku = await searchProducts({ organizationId: t.org.id, q: "SEEDP-5" });
    assert.deepEqual(bySku[0].variants.map((v) => [v.sku, v.price]), [["SEEDP-5", "480.00"]]);
    const scanned = await searchProducts({ organizationId: t.org.id, q: "VARIANT-CODE-5" });
    assert.equal(scanned[0].id, product.id, "a variant's barcode finds the product");
    assert.equal(scanned[0].matchedVariantId, variant.id, "and says which variant was scanned");
  });
});

test("customers are searched by name or phone, 20 at a time, with what they owe", async () => {
  await withTestOrg(async (t) => {
    await prisma.customer.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ organizationId: t.org.id, name: `Farmer ${String(i + 1).padStart(2, "0")}`, phone: `0171100${String(i + 1).padStart(4, "0")}` })) });
    await prisma.customer.create({ data: { organizationId: t.org.id, name: "Rahim Store", phone: "01999888777" } });
    assert.equal((await searchCustomers({ organizationId: t.org.id, q: "farmer" })).length, 20);
    assert.deepEqual((await searchCustomers({ organizationId: t.org.id, q: "rahim" })).map((c) => c.name), ["Rahim Store"]);
    const byPhone = await searchCustomers({ organizationId: t.org.id, q: "01999888777" });
    assert.deepEqual([byPhone[0]?.name, byPhone[0]?.outstanding], ["Rahim Store", "0.00"]);
    assert.deepEqual(await searchCustomers({ organizationId: t.org.id, q: "" }), []);
  });
});
