import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { ensurePriceLevels, pickPrice, resolvePrice, setPrices, type PriceRow } from "./index.ts";

// P04 task 2 (D6): which price a product sells at. The level chosen, then the largest quantity step not above the quantity; a variant's
// own price comes before the product's at the same level; no price at the level falls back to the default (Retail); never below the
// minimum price.

const dec = (value: string) => new Prisma.Decimal(value);
const RETAIL = "retail";
const WHOLESALE = "wholesale";
const DEALER = "dealer";

const row = (priceLevelId: string, minQty: string, price: string, variantScope = ""): PriceRow => ({ priceLevelId, minQty: dec(minQty), price: dec(price), variantScope });

const book: PriceRow[] = [
  row(RETAIL, "1", "100"),
  row(WHOLESALE, "1", "95"),
  row(WHOLESALE, "10", "90"),
  row(WHOLESALE, "50", "85"),
  row(DEALER, "100", "80"),
];

const pick = (quantity: string, levelId: string, over: Partial<Parameters<typeof pickPrice>[0]> = {}) =>
  pickPrice({ rows: book, levelId, defaultLevelId: RETAIL, quantity: dec(quantity), minimumPrice: dec("1"), ...over });

const cases: Array<[string, string, string, string, string]> = [
  // name, quantity, level, expected price, expected level
  ["retail, one unit", "1", RETAIL, "100", RETAIL],
  ["retail has one step: more units, same price", "500", RETAIL, "100", RETAIL],
  ["wholesale below its first bulk step", "9", WHOLESALE, "95", WHOLESALE],
  ["wholesale at the 10+ step", "10", WHOLESALE, "90", WHOLESALE],
  ["wholesale just under 10 (9.9999) is still the first step", "9.9999", WHOLESALE, "95", WHOLESALE],
  ["wholesale between 10+ and 50+", "49", WHOLESALE, "90", WHOLESALE],
  ["wholesale at the 50+ step", "50", WHOLESALE, "85", WHOLESALE],
  ["wholesale far above the last step", "5000", WHOLESALE, "85", WHOLESALE],
  ["dealer only starts at 100: below it, the default level answers", "99", DEALER, "100", RETAIL],
  ["dealer at its step", "100", DEALER, "80", DEALER],
  ["an unknown level falls back to the default", "1", "no-such-level", "100", RETAIL],
];
for (const [name, quantity, level, price, expectedLevel] of cases) {
  test(`pickPrice: ${name}`, () => {
    const picked = pick(quantity, level);
    assert.deepEqual([picked?.price.toFixed(2), picked?.levelId], [dec(price).toFixed(2), expectedLevel]);
  });
}

test("pickPrice: a variant's own price at the level comes before the product's", () => {
  const rows = [...book, row(WHOLESALE, "1", "97", "variant-1"), row(RETAIL, "1", "110", "variant-1")];
  assert.equal(pickPrice({ rows, variantId: "variant-1", levelId: WHOLESALE, defaultLevelId: RETAIL, quantity: dec("1"), minimumPrice: dec("1") })?.price.toFixed(2), "97.00");
  assert.equal(pickPrice({ rows, variantId: "variant-1", levelId: RETAIL, defaultLevelId: RETAIL, quantity: dec("1"), minimumPrice: dec("1") })?.price.toFixed(2), "110.00");
  assert.equal(pickPrice({ rows, variantId: "variant-2", levelId: RETAIL, defaultLevelId: RETAIL, quantity: dec("1"), minimumPrice: dec("1") })?.price.toFixed(2), "100.00", "another variant has no price of its own");
});

test("pickPrice: a variant with no price at the level uses the product's price at that level, not its own Retail price", () => {
  const rows = [...book, row(RETAIL, "1", "110", "variant-1")];
  const picked = pickPrice({ rows, variantId: "variant-1", levelId: WHOLESALE, defaultLevelId: RETAIL, quantity: dec("10"), minimumPrice: dec("1") });
  assert.deepEqual([picked?.price.toFixed(2), picked?.levelId], ["90.00", WHOLESALE]);
});

test("pickPrice: never below the minimum price, and it says so", () => {
  const low = pick("50", WHOLESALE, { minimumPrice: dec("88") });
  assert.deepEqual([low?.price.toFixed(2), low?.floored], ["88.00", true]);
  const exact = pick("50", WHOLESALE, { minimumPrice: dec("85") });
  assert.deepEqual([exact?.price.toFixed(2), exact?.floored], ["85.00", false]);
});

test("pickPrice: a product with no price at all has none", () => {
  assert.equal(pickPrice({ rows: [], levelId: RETAIL, defaultLevelId: RETAIL, quantity: dec("1"), minimumPrice: dec("1") }), null);
});

test("resolvePrice: the customer's type decides the level, and the quantity the step", async () => {
  await withTestOrg(async (t) => {
    const levels = await ensurePriceLevels(prisma, t.org.id);
    const product = await factories(t).product({ sellingPrice: "100.00", wholesalePrice: "95.00", minimumPrice: "50.00" });
    await setPrices(prisma, { organizationId: t.org.id, productId: product.id, prices: [
      { level: "Retail", minQty: "1", price: "100.00" },
      { level: "Wholesale", minQty: "1", price: "95.00" },
      { level: "Wholesale", minQty: "10", price: "90.00" },
      { level: "Dealer", minQty: "1", price: "80.00" },
    ] });
    const dealerType = await prisma.customerType.create({ data: { organizationId: t.org.id, name: "Dealer", priceLevelId: levels.byName.get("Dealer")?.id } });
    const base = { organizationId: t.org.id, productId: product.id };
    assert.equal((await resolvePrice(prisma, { ...base, quantity: "1" }))?.price.toFixed(2), "100.00", "no level named: the default");
    assert.equal((await resolvePrice(prisma, { ...base, quantity: "10", level: "Wholesale" }))?.price.toFixed(2), "90.00");
    const byType = await resolvePrice(prisma, { ...base, quantity: "1", customerTypeId: dealerType.id });
    assert.deepEqual([byType?.price.toFixed(2), byType?.levelName], ["80.00", "Dealer"]);
    const retailType = await prisma.customerType.create({ data: { organizationId: t.org.id, name: "Walk-in" } });
    assert.equal((await resolvePrice(prisma, { ...base, quantity: "1", customerTypeId: retailType.id }))?.price.toFixed(2), "100.00", "a type with no level buys at the default");
    const floor = await resolvePrice(prisma, { ...base, quantity: "1", level: "Dealer" });
    assert.equal(floor?.price.toFixed(2), "80.00");
    await prisma.product.update({ where: { id: product.id }, data: { minimumPrice: "85.00" } });
    const floored = await resolvePrice(prisma, { ...base, quantity: "1", level: "Dealer" });
    assert.deepEqual([floored?.price.toFixed(2), floored?.floored], ["85.00", true]);
  });
});

test("setPrices: replaces the product's steps, keeps Retail and Wholesale of the product columns in step, refuses a duplicate step", async () => {
  await withTestOrg(async (t) => {
    await ensurePriceLevels(prisma, t.org.id);
    const product = await factories(t).product({ sellingPrice: "100.00", wholesalePrice: "95.00" });
    await setPrices(prisma, { organizationId: t.org.id, productId: product.id, prices: [{ level: "Retail", minQty: "1", price: "120.00" }, { level: "Wholesale", minQty: "1", price: "99.00" }, { level: "Wholesale", minQty: "20", price: "92.00" }] });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.deepEqual([after.sellingPrice.toFixed(2), after.wholesalePrice.toFixed(2)], ["120.00", "99.00"], "the product's own price columns follow the first step of Retail and Wholesale");
    assert.equal(await prisma.productPrice.count({ where: { organizationId: t.org.id, productId: product.id } }), 3);
    await assert.rejects(setPrices(prisma, { organizationId: t.org.id, productId: product.id, prices: [{ level: "Retail", minQty: "1", price: "1.00" }, { level: "Retail", minQty: "1", price: "2.00" }] }), /twice/);
    assert.equal(await prisma.productPrice.count({ where: { organizationId: t.org.id, productId: product.id } }), 3, "a refused list changes nothing");
    await assert.rejects(setPrices(prisma, { organizationId: t.org.id, productId: product.id, prices: [{ level: "Nope", minQty: "1", price: "1.00" }] }), /level/i);
    await assert.rejects(setPrices(prisma, { organizationId: t.org.id, productId: product.id, prices: [{ level: "Retail", minQty: "0", price: "1.00" }] }), /quantity/i);
  });
});
