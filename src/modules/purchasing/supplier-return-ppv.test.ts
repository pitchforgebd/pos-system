import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { postPurchase } from "./purchases.ts";
import { postPurchaseReturn } from "./returns.ts";

// P03 task 5 (#16): a supplier return takes the goods out of stock at the average cost, and gives the vendor back the bill price.
// Dr AP (bill price) / Cr Inventory (average); the difference is Purchase Price Variance, so the inventory account still equals
// the stock x average cost.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T) => ({ ...t.actor, idempotencyKey: "" });

async function setup(t: T) {
  const product = await factories(t).product({ purchasePrice: "10.00" });
  const supplier = await factories(t).vendor();
  const buy = async (units: string, unitCost: string, businessDate: string) => {
    const bought = await postPurchase({ ...actor(t), idempotencyKey: randomUUID(), supplierId: supplier.id, businessDate, lines: [{ productId: product.id, quantity: units, unitCost }] });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    return bought.ok ? bought.id : "";
  };
  const first = await buy("10", "10.00", "2026-10-01");
  const second = await buy("10", "20.00", "2026-10-02"); // average is now 15.0000 on 20 units
  return { product, supplier, first, second };
}

async function returnOf(t: T, purchaseId: string, quantity: string) {
  const item = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId } });
  const done = await postPurchaseReturn({ ...actor(t), idempotencyKey: randomUUID(), purchaseId, businessDate: "2026-10-03", lines: [{ purchaseItemId: item.id, quantity }] });
  assert.equal(done.ok, true, JSON.stringify(done));
  return done.ok ? done.id : "";
}

const lines = async (t: T, returnId: string) =>
  (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "PURCHASE_RETURN", docId: returnId } }, include: { account: { include: { roles: true } } } })).map((l) => ({
    role: l.account.roles.map((r) => r.role).join(","),
    debit: Number(l.debit),
    credit: Number(l.credit),
  }));

test("returning goods bought dearer than the average: the stock leaves at the average, the difference is a gain (Cr PPV)", async () => {
  await withTestOrg(async (t) => {
    const { second } = await setup(t);
    const id = await returnOf(t, second, "5"); // bill price 20.00 x 5 = 100.00; average 15.00 x 5 = 75.00
    assert.deepEqual((await lines(t, id)).sort((a, b) => a.role.localeCompare(b.role)), [
      { role: "AP", debit: 100, credit: 0 },
      { role: "INVENTORY", debit: 0, credit: 75 },
      { role: "PPV", debit: 0, credit: 25 },
    ]);
    const out = await prisma.stockLedger.findFirstOrThrow({ where: { organizationId: t.org.id, movementType: "SUPPLIER_RETURN" } });
    assert.deepEqual([out.unitCost?.toFixed(4), out.totalCost?.toFixed(2)], ["15.0000", "75.00"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("returning goods bought cheaper than the average: the difference is a loss (Dr PPV)", async () => {
  await withTestOrg(async (t) => {
    const { first } = await setup(t);
    const id = await returnOf(t, first, "4"); // bill price 10.00 x 4 = 40.00; average 15.00 x 4 = 60.00
    assert.deepEqual((await lines(t, id)).sort((a, b) => a.role.localeCompare(b.role)), [
      { role: "AP", debit: 40, credit: 0 },
      { role: "INVENTORY", debit: 0, credit: 60 },
      { role: "PPV", debit: 20, credit: 0 },
    ]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("returning goods at exactly the average has no variance line", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ purchasePrice: "10.00" });
    const supplier = await factories(t).vendor();
    const bought = await postPurchase({ ...actor(t), idempotencyKey: randomUUID(), supplierId: supplier.id, businessDate: "2026-10-01", lines: [{ productId: product.id, quantity: "10", unitCost: "10.00" }] });
    assert.equal(bought.ok, true);
    const id = await returnOf(t, bought.ok ? bought.id : "", "3");
    assert.deepEqual((await lines(t, id)).map((l) => l.role).sort(), ["AP", "INVENTORY"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
