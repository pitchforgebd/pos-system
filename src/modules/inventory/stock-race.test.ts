import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { runTx } from "../../core/tx/run.ts";
import { prisma } from "../../lib/db/client.ts";
import { concurrentlySettled, factories, withTestOrg } from "../../tests/helpers/index.ts";
import { applyMovement } from "./stock.ts";

// N21, step 1(a): is the deadlock that sometimes fails a parallel test run a race in the product (two requests
// creating the same new stock row at the same time), or only tests colliding with each other? This file has no
// other file's cleanup in it, so a failure here is the product.
//
// A stock row is the pair (product, warehouse). The first stock-in creates it. Real requests run at READ COMMITTED
// (defineRoute); a direct service call runs at the database default, REPEATABLE READ. Retries are switched off
// to see the race itself, not whether a retry happens to hide it.

const levels = [
  ["READ COMMITTED", Prisma.TransactionIsolationLevel.ReadCommitted],
  ["REPEATABLE READ", Prisma.TransactionIsolationLevel.RepeatableRead],
] as const;

for (const [name, isolationLevel] of levels) {
  test(`ten parallel first stock-ins on one new stock row all succeed at ${name}, with no retry to lean on`, async () => {
    await withTestOrg(async (t) => {
      const product = await factories(t).product();
      const settled = await concurrentlySettled(10, () =>
        runTx(
          (tx) =>
            applyMovement(tx, {
              organizationId: t.org.id,
              productId: product.id,
              branchId: t.branch.id,
              warehouseId: t.warehouse.id,
              quantity: new Prisma.Decimal("1"),
              direction: "IN",
              movementType: "OPENING",
              referenceType: "test",
              referenceId: randomUUID(),
              userId: t.owner.id,
              unitCost: new Prisma.Decimal("10.00"),
            }),
          { isolationLevel, retries: 0 },
        ),
      );
      const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => `${(r.reason as { code?: string }).code ?? "?"}: ${String((r.reason as Error).message).split("\n").pop()}`);
      assert.deepEqual(failures, [], "every parallel stock-in must succeed");

      const rows = await prisma.stockBalance.findMany({ where: { organizationId: t.org.id, productId: product.id } });
      assert.equal(rows.length, 1, "one stock row, not one per request");
      assert.equal(rows[0].quantity.toFixed(4), "10.0000");
      const ledger = await prisma.stockLedger.aggregate({ where: { organizationId: t.org.id, productId: product.id }, _sum: { quantity: true }, _count: true });
      assert.equal(ledger._count, 10);
      assert.equal(ledger._sum.quantity?.toFixed(4), "10.0000", "the balance equals the sum of the ledger");
    });
  });
}

const move = (t: { org: { id: string }; branch: { id: string }; warehouse: { id: string }; owner: { id: string } }, productId: string, direction: "IN" | "OUT", quantity: string, extra: { variantId?: string } = {}) =>
  runTx(
    (tx) =>
      applyMovement(tx, {
        organizationId: t.org.id,
        productId,
        branchId: t.branch.id,
        warehouseId: t.warehouse.id,
        quantity: new Prisma.Decimal(quantity),
        direction,
        movementType: direction === "IN" ? "OPENING" : "ADJUSTMENT",
        referenceType: "test",
        referenceId: randomUUID(),
        userId: t.owner.id,
        unitCost: direction === "IN" ? new Prisma.Decimal("10.00") : null,
        ...extra,
      }),
    { retries: 0 },
  );

test("an OUT on a stock row that does not exist is refused, and no empty row is left behind", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    await assert.rejects(move(t, product.id, "OUT", "1"), /Insufficient stock/);
    assert.equal(await prisma.stockBalance.count({ where: { organizationId: t.org.id, productId: product.id } }), 0);
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: t.org.id, productId: product.id } }), 0);
  });
});

test("forty parallel first stock-ins across several new rows, then a storm of ins and outs: balances equal the ledger, nothing fails", async () => {
  await withTestOrg(async (t) => {
    const f = factories(t);
    const products = [await f.product(), await f.product(), await f.product(), await f.product()];
    const first = await concurrentlySettled(40, (index) => move(t, products[index % products.length].id, "IN", "5"));
    assert.deepEqual(first.filter((r) => r.status === "rejected"), []);

    // 60 more at once on the rows that now exist: 40 ins of 1 and 20 outs of 1 (stock is 50 per row, so no refusal)
    const storm = await concurrentlySettled(60, (index) => move(t, products[index % products.length].id, index % 3 === 0 ? "OUT" : "IN", "1"));
    assert.deepEqual(storm.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message).split("\n").pop()), []);

    for (const product of products) {
      const rows = await prisma.stockBalance.findMany({ where: { organizationId: t.org.id, productId: product.id } });
      assert.equal(rows.length, 1, "one stock row per product");
      const ledger = await prisma.stockLedger.findMany({ where: { organizationId: t.org.id, productId: product.id }, select: { direction: true, quantity: true } });
      const sum = ledger.reduce((total, row) => (row.direction === "IN" ? total.plus(row.quantity) : total.minus(row.quantity)), new Prisma.Decimal(0));
      assert.equal(rows[0].quantity.toFixed(4), sum.toFixed(4), "balance = sum of the ledger");
    }
  });
});

test("a stock row for a variant is its own row, created without a race too", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    const variants = await Promise.all(
      ["Small", "Large"].map((name) =>
        prisma.productVariant.create({ data: { organizationId: t.org.id, productId: product.id, sku: `${product.sku}-${name}` } }),
      ),
    );
    const settled = await concurrentlySettled(20, (index) => move(t, product.id, "IN", "1", { variantId: variants[index % 2].id }));
    assert.deepEqual(settled.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message).split("\n").pop()), []);
    const rows = await prisma.stockBalance.findMany({ where: { organizationId: t.org.id, productId: product.id }, orderBy: { variantId: "asc" } });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.quantity.toFixed(4)), ["10.0000", "10.0000"]);
  });
});
