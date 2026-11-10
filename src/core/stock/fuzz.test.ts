import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { postAdjustment, postDamage, postOpeningStock, postOwnStock, postTakeOff, postTransfer } from "../../modules/inventory/documents.ts";
import { ledgerMatchesBalance } from "../../modules/inventory/stock.ts";
import { postSale } from "../../modules/sales/sales.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { assertBooksReconcile } from "../reconcile/index.ts";
import { businessDate as today } from "../time/business-date.ts";

// P03: 500 random stock operations (seeded, so a failure can be repeated) across three products, two branches and three warehouses:
// openings, own stock, adjustments, damage, take-offs, sales and transfers inside and between branches, many of them refused for lack
// of stock. Afterwards every invariant holds: the stock equals its movements (I4), the inventory account equals the stock at its
// average cost within rounding (I6), the books balance (I1, I15), no stock is negative (D5).

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("500 random stock operations leave the books and the stock in agreement", { timeout: 600_000 }, async () => {
  await withTestOrg(async (t) => {
    const random = seeded(20261111);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
    const whole = (max: number) => String(1 + Math.floor(random() * max));
    const factory = factories(t);
    const products = [await factory.product({ sellingPrice: "15.00", purchasePrice: "9.00", wholesalePrice: "15.00", minimumPrice: "1.00" }), await factory.product({ sellingPrice: "40.00", purchasePrice: "25.00", wholesalePrice: "40.00", minimumPrice: "1.00" }), await factory.product({ sellingPrice: "7.50", purchasePrice: "4.00", wholesalePrice: "7.50", minimumPrice: "1.00" })];
    const a2 = await prisma.warehouse.create({ data: { organizationId: t.org.id, branchId: t.branch.id, name: "A2" } });
    const branchB = await prisma.branch.create({ data: { organizationId: t.org.id, name: "Branch B" } });
    const b1 = await prisma.warehouse.create({ data: { organizationId: t.org.id, branchId: branchB.id, name: "B1" } });
    const places = [
      { branchId: t.branch.id, warehouseId: t.warehouse.id },
      { branchId: t.branch.id, warehouseId: a2.id },
      { branchId: branchB.id, warehouseId: b1.id },
    ];
    const base = { organizationId: t.org.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test" };
    const key = () => ({ idempotencyKey: randomUUID() });
    const refused: Record<string, number> = {};
    const done: Record<string, number> = {};
    const count = (name: string, ok: boolean) => {
      (ok ? done : refused)[name] = ((ok ? done : refused)[name] ?? 0) + 1;
    };

    for (let step = 1; step <= 500; step += 1) {
      const place = pick(places);
      const where = { ...base, ...place };
      const product = pick(products);
      const op = pick(["opening", "opening", "own", "adjustIn", "adjustOut", "damage", "takeoff", "sale", "sale", "transfer"] as const);
      let result: { ok: boolean };
      if (op === "opening" || op === "own") {
        const line = { productId: product.id, quantity: whole(20), unitCost: (1 + random() * 29).toFixed(4) };
        result = await (op === "opening" ? postOpeningStock : postOwnStock)({ ...where, ...key(), businessDate: today(), lines: [line] });
      } else if (op === "adjustIn" || op === "adjustOut") {
        result = await postAdjustment({ ...where, ...key(), productId: product.id, quantity: whole(8), direction: op === "adjustIn" ? "IN" : "OUT", reason: "fuzz" });
      } else if (op === "damage") {
        result = await postDamage({ ...where, ...key(), productId: product.id, businessDate: today(), place: "x", purchasePrice: "1.00", salePrice: "1.00", discountAmount: "0.00", vatAmount: "0.00", quantity: whole(6), reason: "fuzz" });
      } else if (op === "takeoff") {
        result = await postTakeOff({ ...where, ...key(), businessDate: today(), purpose: pick(["SAMPLE", "DEMO", "OWN_USE", "GIFT"] as const), recipient: "r", approvedBy: "a", lines: [{ productId: product.id, quantity: whole(6) }] });
      } else if (op === "sale") {
        const quantity = whole(5);
        const paid = (Number(product.sellingPrice) * Number(quantity)).toFixed(2);
        result = await postSale({ ...where, ...key(), businessDate: today(), lines: [{ productId: product.id, quantity }], paymentAmount: paid, paymentMethod: "CASH" } as Parameters<typeof postSale>[0]);
      } else {
        const to = pick(places.filter((p) => p.warehouseId !== place.warehouseId));
        result = await postTransfer({ ...base, fromBranchId: place.branchId, toBranchId: to.branchId, fromWarehouseId: place.warehouseId, toWarehouseId: to.warehouseId, lines: [{ productId: product.id, quantity: whole(6) }], ...key() });
      }
      count(op, result.ok);
      if (step % 125 === 0) {
        await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
      }
    }

    assert.ok(Object.values(done).reduce((a, b) => a + b, 0) > 250, `most operations should succeed: ${JSON.stringify(done)} refused ${JSON.stringify(refused)}`);
    assert.ok(Object.keys(done).length >= 8, `every kind of operation happened: ${JSON.stringify(done)}`);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
    for (const place of [t.branch.id, branchB.id]) {
      assert.equal(await ledgerMatchesBalance(t.org.id, place), true, "stock equals its movements");
    }
    assert.equal(await prisma.stockBalance.count({ where: { organizationId: t.org.id, quantity: { lt: 0 } } }), 0, "no stock is negative");
  });
});
