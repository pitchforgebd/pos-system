import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { getProductDetail } from "./detail.ts";
import { addVariant } from "./products.ts";
import { addVariationValue, createVariationHead, listVariationHeads, removeVariationHead, removeVariationValue } from "./variations.ts";

// P04 task 5 (H10): variation heads (Size, Colour, Pack) and their values are managed by the owner, and a product's variants are
// made from them. Real data, not a sample.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const org = (t: T) => ({ organizationId: t.org.id });

test("heads and values are added, listed, and kept unique", async () => {
  await withTestOrg(async (t) => {
    const size = await createVariationHead({ ...org(t), name: "Size" });
    assert.equal(size.ok, true, JSON.stringify(size));
    const headId = size.ok ? size.id : "";
    for (const value of ["1 kg", "5 kg", "25 kg"]) {
      assert.equal((await addVariationValue({ ...org(t), headId, value })).ok, true, value);
    }
    const dup = await addVariationValue({ ...org(t), headId, value: "5 kg" });
    assert.deepEqual([dup.ok, dup.ok ? 0 : dup.status], [false, 409]);
    const sameHead = await createVariationHead({ ...org(t), name: "Size" });
    assert.deepEqual([sameHead.ok, sameHead.ok ? 0 : sameHead.status], [false, 409]);
    assert.equal((await createVariationHead({ ...org(t), name: "  " })).ok, false);
    const listed = await listVariationHeads(t.org.id);
    assert.deepEqual(listed.map((h) => [h.name, h.values.map((v) => v.value)]), [["Size", ["1 kg", "25 kg", "5 kg"]]]);
  });
});

test("a variant takes one value of each head it is described by, and a value in use cannot be removed", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ sellingPrice: "100.00" });
    const size = await createVariationHead({ ...org(t), name: "Size" });
    const pack = await createVariationHead({ ...org(t), name: "Pack" });
    const sizeId = size.ok ? size.id : "";
    const packId = pack.ok ? pack.id : "";
    const five = await addVariationValue({ ...org(t), headId: sizeId, value: "5 kg" });
    const twentyFive = await addVariationValue({ ...org(t), headId: sizeId, value: "25 kg" });
    const sack = await addVariationValue({ ...org(t), headId: packId, value: "Sack" });
    const fiveId = five.ok ? five.id : "";
    const twentyFiveId = twentyFive.ok ? twentyFive.id : "";
    const sackId = sack.ok ? sack.id : "";

    const made = await addVariant({ organizationId: t.org.id, productId: product.id, sku: "SEED-5KG", price: "120.00", values: [{ headId: sizeId, valueId: fiveId }, { headId: packId, valueId: sackId }] });
    assert.equal(made.ok, true, JSON.stringify(made));
    const detail = await getProductDetail(t.org.id, product.id, { cost: false });
    assert.deepEqual(detail?.variants.map((v) => [v.sku, v.price, [...v.values].sort()]), [["SEED-5KG", "120.00", ["Pack: Sack", "Size: 5 kg"]]]);
    const retailRow = await prisma.productPrice.findFirst({ where: { organizationId: t.org.id, productId: product.id, variantScope: { not: "" } }, include: { priceLevel: true } });
    assert.deepEqual([retailRow?.priceLevel.name, retailRow?.price.toFixed(2)], ["Retail", "120.00"], "a variant's own price is a price-list row");

    const twoOfOne = await addVariant({ organizationId: t.org.id, productId: product.id, sku: "BAD-1", values: [{ headId: sizeId, valueId: fiveId }, { headId: sizeId, valueId: twentyFiveId }] });
    assert.equal(twoOfOne.ok, false, "two values of one head");
    const wrongHead = await addVariant({ organizationId: t.org.id, productId: product.id, sku: "BAD-2", values: [{ headId: packId, valueId: fiveId }] });
    assert.equal(wrongHead.ok, false, "a value that belongs to another head");
    assert.equal(await prisma.productVariant.count({ where: { organizationId: t.org.id } }), 1, "refused variants leave nothing behind");

    const inUse = await removeVariationValue({ ...org(t), valueId: fiveId });
    assert.equal(inUse.ok, false, "a value a variant uses stays");
    assert.equal((await removeVariationValue({ ...org(t), valueId: twentyFiveId })).ok, true, "an unused value goes");
    assert.equal((await removeVariationHead({ ...org(t), headId: sizeId })).ok, false, "a head with a value in use stays");
    const emptyHead = await createVariationHead({ ...org(t), name: "Colour" });
    assert.equal((await removeVariationHead({ ...org(t), headId: emptyHead.ok ? emptyHead.id : "" })).ok, true);
  });
});
