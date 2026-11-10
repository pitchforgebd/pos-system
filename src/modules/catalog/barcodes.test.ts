import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { concurrentlySettled, factories, withTestOrg } from "../../tests/helpers/index.ts";
import { setPrices } from "../pricing/index.ts";
import { barcodeBars, CODE39, ean13CheckDigit, generateBarcode, isValidEan13 } from "./ean13.ts";
import { listBarcodes, listBarcodePrints, recordBarcodePrint } from "./barcodes.ts";
import { addBarcode } from "./products.ts";

// P04 task 6 (feature 11): a product can carry several barcodes; the shop can make its own EAN-13 (the 200-299 range is for in-store use);
// labels are printed on an A4 sheet or a 38 x 25 mm label at the price of the level chosen, and every print is recorded.

test("EAN-13 check digits: known codes, and a wrong digit is caught", () => {
  assert.equal(ean13CheckDigit("400638133393"), 1);
  assert.equal(ean13CheckDigit("590123412345"), 7);
  assert.equal(ean13CheckDigit("200000000001"), 5);
  assert.equal(isValidEan13("4006381333931"), true);
  assert.equal(isValidEan13("4006381333932"), false);
  assert.equal(isValidEan13("400638133393"), false, "twelve digits is not an EAN-13");
  assert.equal(isValidEan13("40063813339a1"), false);
});

test("every Code 39 pattern has exactly three wide elements", () => {
  for (const [char, pattern] of Object.entries(CODE39)) {
    assert.equal(pattern.length, 9, char);
    assert.equal([...pattern].filter((element) => element === "w").length, 3, char);
  }
});

test("bars: an EAN-13 is 95 modules with its guards; a code that is not an EAN-13 is drawn as Code 39 or not at all", () => {
  const ean = barcodeBars("4006381333931");
  assert.equal(ean?.kind, "EAN13");
  assert.equal(ean?.modules.length, 95);
  assert.ok(ean?.modules.startsWith("101") && ean.modules.endsWith("101"), "start and end guards");
  assert.equal(ean?.modules.slice(45, 50), "01010", "centre guard");
  const code39 = barcodeBars("SEED-5KG");
  assert.equal(code39?.kind, "CODE39");
  assert.ok((code39?.modules.length ?? 0) > 50);
  assert.equal(barcodeBars("naïve é"), null, "characters no symbology here can draw");
  assert.equal(barcodeBars(""), null);
});

test("the shop's own barcodes are EAN-13 in the 200 range, one after the other, never twice", async () => {
  await withTestOrg(async (t) => {
    const factory = factories(t);
    const product = await factory.product();
    const other = await factory.product();
    const first = await generateBarcode({ organizationId: t.org.id, productId: product.id });
    const second = await generateBarcode({ organizationId: t.org.id, productId: other.id });
    assert.equal(first.ok, true, JSON.stringify(first));
    const codes = [first, second].map((r) => (r.ok ? r.barcode.barcode : ""));
    assert.ok(codes.every((code) => isValidEan13(code) && code.startsWith("200")), codes.join(","));
    assert.notEqual(codes[0], codes[1]);
    assert.equal(Number(codes[1].slice(0, 12)) - Number(codes[0].slice(0, 12)), 1, "numbered one after the other");
  });
});

test("barcodes generated at the same moment are all different", async () => {
  await withTestOrg(async (t) => {
    const factory = factories(t);
    const products = await Promise.all([1, 2, 3, 4].map(() => factory.product()));
    const results = await concurrentlySettled(4, (index) => generateBarcode({ organizationId: t.org.id, productId: products[index % 4].id }));
    const codes = results.map((r) => (r.status === "fulfilled" && r.value.ok ? r.value.barcode.barcode : ""));
    assert.equal(new Set(codes).size, 4, codes.join(","));
    assert.ok(codes.every((code) => isValidEan13(code)));
  });
});

test("a product has several barcodes; the same barcode cannot belong to two products (409)", async () => {
  await withTestOrg(async (t) => {
    const factory = factories(t);
    const a = await factory.product();
    const b = await factory.product();
    assert.equal((await addBarcode({ organizationId: t.org.id, productId: a.id, barcode: "8901234567890" })).ok, true);
    assert.equal((await addBarcode({ organizationId: t.org.id, productId: a.id, barcode: "ALT-001" })).ok, true, "a second barcode on the same product");
    const clash = await addBarcode({ organizationId: t.org.id, productId: b.id, barcode: "8901234567890" });
    assert.deepEqual([clash.ok, clash.ok ? 0 : clash.status], [false, 409]);
    assert.equal(await prisma.productBarcode.count({ where: { organizationId: t.org.id, productId: a.id } }), 2);
  });
});

test("a label shows the price of the level chosen, and the print is recorded with the level, the layout and the copies", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ sellingPrice: "100.00", wholesalePrice: "90.00" });
    await setPrices(prisma, { organizationId: t.org.id, productId: product.id, prices: [{ level: "Retail", minQty: "1", price: "100.00" }, { level: "Wholesale", minQty: "1", price: "90.00" }] });
    const added = await addBarcode({ organizationId: t.org.id, productId: product.id, barcode: "4006381333931" });
    const barcodeId = added.ok ? added.barcode.id : "";

    const retail = await listBarcodes(t.org.id, {});
    assert.deepEqual(retail.map((r) => [r.barcode, r.price]), [["4006381333931", "100.00"]]);
    const wholesale = await listBarcodes(t.org.id, { level: "Wholesale" });
    assert.equal(wholesale[0].price, "90.00");
    assert.deepEqual((await listBarcodes(t.org.id, { search: "nothing like it" })), []);

    const label = await recordBarcodePrint({ organizationId: t.org.id, userId: t.owner.id, barcodeId, copies: 3, level: "Wholesale", format: "LABEL_38X25", ip: "127.0.0.1", userAgent: "test" });
    assert.equal(label.ok, true, JSON.stringify(label));
    assert.deepEqual(label.ok ? [label.sellingPrice, label.level, label.format, label.copies] : [], ["90.00", "Wholesale", "LABEL_38X25", 3]);
    const report = await listBarcodePrints(t.org.id);
    assert.deepEqual([report[0].copies, report[0].level, report[0].format], ["3", "Wholesale", "LABEL_38X25"]);
    assert.equal((await recordBarcodePrint({ organizationId: t.org.id, userId: t.owner.id, barcodeId, copies: 0, ip: "x", userAgent: null })).ok, false);
    assert.equal((await recordBarcodePrint({ organizationId: t.org.id, userId: t.owner.id, barcodeId, copies: 1, level: "Nope", ip: "x", userAgent: null })).ok, false);
  });
});
