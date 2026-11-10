import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { createPriceLevel, listPriceLevels, setCustomerTypeLevel, updatePriceLevel } from "./admin.ts";
import { resolvePrice, setPrices } from "./index.ts";

// P04 task 4: the owner adds price levels, renames and switches them, chooses the default, and says which level a customer type buys at.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const who = (t: T) => ({ organizationId: t.org.id, actorId: t.owner.id, ip: "127.0.0.1", userAgent: "test" });

test("an organization starts with Retail (default), Wholesale and Dealer; the owner adds a level, and a name is unique", async () => {
  await withTestOrg(async (t) => {
    const start = await listPriceLevels(t.org.id);
    assert.deepEqual(start.map((l) => [l.name, l.isDefault]), [["Retail", true], ["Wholesale", false], ["Dealer", false]]);
    const added = await createPriceLevel({ ...who(t), name: "Export" });
    assert.equal(added.ok, true);
    assert.deepEqual((await listPriceLevels(t.org.id)).map((l) => l.name), ["Retail", "Wholesale", "Dealer", "Export"]);
    const duplicate = await createPriceLevel({ ...who(t), name: "Export" });
    assert.deepEqual([duplicate.ok, duplicate.ok ? 0 : duplicate.status], [false, 409]);
    assert.equal((await createPriceLevel({ ...who(t), name: "  " })).ok, false);
  });
});

test("the default level can be moved, never switched off, and a renamed level keeps its prices", async () => {
  await withTestOrg(async (t) => {
    await listPriceLevels(t.org.id);
    const levels = await prisma.priceLevel.findMany({ where: { organizationId: t.org.id } });
    const by = Object.fromEntries(levels.map((l) => [l.name, l.id]));
    const off = await updatePriceLevel({ ...who(t), id: by.Retail, status: "INACTIVE" });
    assert.equal(off.ok, false, "the default cannot be switched off");
    assert.equal((await updatePriceLevel({ ...who(t), id: by.Wholesale, makeDefault: true })).ok, true);
    const after = await listPriceLevels(t.org.id);
    assert.deepEqual(after.filter((l) => l.isDefault).map((l) => l.name), ["Wholesale"], "exactly one default");
    assert.equal((await updatePriceLevel({ ...who(t), id: by.Retail, status: "INACTIVE" })).ok, true, "Retail is no longer the default");

    const product = await prisma.product.create({ data: { organizationId: t.org.id, sku: "P-1", liveSku: "P-1", name: "P", slug: "p", purchasePrice: "1", sellingPrice: "10", wholesalePrice: "8", minimumPrice: "1", trackStock: true, trackExpiry: false, trackBatch: false, trackSerial: false } });
    await setPrices(prisma, { organizationId: t.org.id, productId: product.id, prices: [{ level: "Dealer", minQty: "1", price: "7.00" }] });
    assert.equal((await updatePriceLevel({ ...who(t), id: by.Dealer, name: "Distributor" })).ok, true);
    assert.equal((await resolvePrice(prisma, { organizationId: t.org.id, productId: product.id, quantity: "1", level: "Distributor" }))?.price.toFixed(2), "7.00");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: t.org.id, entityType: "price_level", entityId: by.Dealer } });
    assert.match(JSON.stringify(audit.after), /Distributor/);
  });
});

test("a customer type buys at its level; an inactive or foreign level is refused; none means the default", async () => {
  await withTestOrg(async (t) => {
    await listPriceLevels(t.org.id);
    const dealer = await prisma.priceLevel.findFirstOrThrow({ where: { organizationId: t.org.id, name: "Dealer" } });
    const type = await prisma.customerType.create({ data: { organizationId: t.org.id, name: "Dealers" } });
    assert.equal((await setCustomerTypeLevel({ ...who(t), customerTypeId: type.id, priceLevelId: dealer.id })).ok, true);
    assert.equal((await prisma.customerType.findUniqueOrThrow({ where: { id: type.id } })).priceLevelId, dealer.id);
    assert.equal((await listPriceLevels(t.org.id)).find((l) => l.name === "Dealer")?.customerTypes, 1);
    await updatePriceLevel({ ...who(t), id: dealer.id, status: "INACTIVE" });
    const other = await prisma.customerType.create({ data: { organizationId: t.org.id, name: "Others" } });
    assert.equal((await setCustomerTypeLevel({ ...who(t), customerTypeId: other.id, priceLevelId: dealer.id })).ok, false, "an inactive level cannot be chosen");
    assert.equal((await setCustomerTypeLevel({ ...who(t), customerTypeId: type.id, priceLevelId: null })).ok, true);
    assert.equal((await prisma.customerType.findUniqueOrThrow({ where: { id: type.id } })).priceLevelId, null);
    assert.equal((await setCustomerTypeLevel({ ...who(t), customerTypeId: type.id, priceLevelId: "00000000-0000-4000-8000-000000000000" })).ok, false);
  });
});
