import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { concurrentlySettled, factories, withTestOrg } from "../../tests/helpers/index.ts";
import { runTx } from "../tx/run.ts";
import { addExpiryLots, applyMovement, type MovementInput } from "./index.ts";

// P03 tasks 1-2: the stock engine. A movement keeps the balance, the moving-average cost, the lots and the ledger row in step and
// says what it cost; lots belong to a warehouse; stock never goes negative.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const dec = (value: string) => new Prisma.Decimal(value);

const move = (t: T, productId: string, direction: "IN" | "OUT", quantity: string, extra: Partial<MovementInput> = {}) =>
  runTx((tx) =>
    applyMovement(tx, {
      organizationId: t.org.id,
      productId,
      branchId: t.branch.id,
      warehouseId: t.warehouse.id,
      quantity: dec(quantity),
      direction,
      movementType: direction === "IN" ? "PURCHASE" : "SALE",
      referenceType: "test",
      referenceId: randomUUID(),
      userId: t.owner.id,
      ...extra,
    }),
  );

test("a movement says what it cost: stock in at its cost, stock out at the average, both to four decimals", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ purchasePrice: "9.00" });
    const first = await move(t, product.id, "IN", "10", { unitCost: dec("6.1234") });
    assert.deepEqual([first.onHand.toFixed(4), first.unitCost.toFixed(4), first.totalCost.toFixed(2)], ["10.0000", "6.1234", "61.23"]);
    const second = await move(t, product.id, "IN", "10", { unitCost: dec("8.0000") });
    assert.equal(second.totalCost.toFixed(2), "80.00");
    // average = (10 x 6.1234 + 10 x 8) / 20 = 7.0617
    const out = await move(t, product.id, "OUT", "4");
    assert.deepEqual([out.unitCost.toFixed(4), out.totalCost.toFixed(2), out.onHand.toFixed(4)], ["7.0617", "28.25", "16.0000"]);
    const row = await prisma.stockLedger.findFirstOrThrow({ where: { organizationId: t.org.id, direction: "OUT" } });
    assert.deepEqual([row.unitCost?.toFixed(4), row.totalCost?.toFixed(2)], ["7.0617", "28.25"]);
    assert.ok(row.businessDate instanceof Date, "the ledger row carries its day");
    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: t.org.id, productId: product.id } });
    assert.equal(balance.averageCost?.toFixed(4), "7.0617", "stock going out leaves the average alone");
  });
});

test("stock coming in without a cost is valued at the average; with no average yet, at the purchase price", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ purchasePrice: "9.00" });
    const first = await move(t, product.id, "IN", "5", { movementType: "ADJUSTMENT" });
    assert.deepEqual([first.unitCost.toFixed(4), first.totalCost.toFixed(2)], ["9.0000", "45.00"]);
    await move(t, product.id, "IN", "5", { unitCost: dec("11.0000") }); // average 10.0000
    const again = await move(t, product.id, "IN", "2", { movementType: "ADJUSTMENT" });
    assert.deepEqual([again.unitCost.toFixed(4), again.totalCost.toFixed(2)], ["10.0000", "20.00"]);
  });
});

test("stock never goes negative, and a refused movement leaves nothing behind (D5)", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    await move(t, product.id, "IN", "3", { unitCost: dec("5") });
    await assert.rejects(move(t, product.id, "OUT", "3.0001"), /Insufficient stock/);
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: t.org.id } }), 1);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: t.org.id } })).quantity.toFixed(4), "3.0000");
  });
});

test("the first stock-in of a new product, twice at the same moment, succeeds twice and adds up", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    const results = await concurrentlySettled(2, () => move(t, product.id, "IN", "4", { unitCost: dec("2") }));
    assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"]);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: t.org.id } })).quantity.toFixed(4), "8.0000");
  });
});

async function secondWarehouse(t: T) {
  return prisma.warehouse.create({ data: { organizationId: t.org.id, branchId: t.branch.id, name: "Second" } });
}

const lotOf = (t: T, productId: string, warehouseId: string) => ({
  organizationId: t.org.id,
  branchId: t.branch.id,
  warehouseId,
  productId,
  lots: [{ lot: "L1", expiresOn: new Date("2030-06-30T00:00:00.000Z"), manufacturedOn: null, quantity: dec("5") }],
});

test("lots belong to a warehouse: a sale from warehouse A never touches warehouse B's lot", async () => {
  await withTestOrg(async (t) => {
    const other = await secondWarehouse(t);
    const product = await factories(t).product({ trackExpiry: true });
    for (const warehouse of [t.warehouse, other]) {
      await move(t, product.id, "IN", "5", { warehouseId: warehouse.id, unitCost: dec("3") });
      await runTx((tx) => addExpiryLots(tx, lotOf(t, product.id, warehouse.id)));
    }
    await move(t, product.id, "OUT", "5", { warehouseId: t.warehouse.id });
    const lots = await prisma.expiryBatch.findMany({ where: { organizationId: t.org.id }, orderBy: { warehouseId: "asc" } });
    const byWarehouse = Object.fromEntries(lots.map((l) => [l.warehouseId, l.quantity.toFixed(4)]));
    assert.equal(byWarehouse[t.warehouse.id], "0.0000", "A's lot is used up");
    assert.equal(byWarehouse[other.id], "5.0000", "B's lot is untouched");
  });
});

test("the same lot received twice, even at the same moment, is one lot whose quantity adds up", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ trackExpiry: true });
    const results = await concurrentlySettled(3, () => runTx((tx) => addExpiryLots(tx, lotOf(t, product.id, t.warehouse.id))));
    assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled", "fulfilled"]);
    const lots = await prisma.expiryBatch.findMany({ where: { organizationId: t.org.id } });
    assert.deepEqual(lots.map((l) => l.quantity.toFixed(4)), ["15.0000"]);
  });
});

test("the earliest expiry is used first, within the warehouse", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ trackExpiry: true });
    await move(t, product.id, "IN", "10", { unitCost: dec("1") });
    await runTx((tx) =>
      addExpiryLots(tx, {
        ...lotOf(t, product.id, t.warehouse.id),
        lots: [
          { lot: "LATE", expiresOn: new Date("2031-01-01T00:00:00.000Z"), manufacturedOn: null, quantity: dec("5") },
          { lot: "SOON", expiresOn: new Date("2029-01-01T00:00:00.000Z"), manufacturedOn: null, quantity: dec("5") },
        ],
      }),
    );
    await move(t, product.id, "OUT", "6");
    const left = Object.fromEntries((await prisma.expiryBatch.findMany({ where: { organizationId: t.org.id } })).map((l) => [l.lot, l.quantity.toFixed(4)]));
    assert.deepEqual(left, { SOON: "0.0000", LATE: "4.0000" });
  });
});
