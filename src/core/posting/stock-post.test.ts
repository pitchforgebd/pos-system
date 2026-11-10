import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { assertBooksReconcile } from "../reconcile/index.ts";
import { runTx } from "../tx/run.ts";
import { businessDate } from "../time/business-date.ts";
import { postWithStock } from "./stock.ts";

// P03 task 3: the stock part of the posting engine. A document that moves stock posts the movements and its journal together: the
// journal is built from what the movements cost, and the inventory account must change by exactly what the stock changed (I3).

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const dec = (value: string) => new Prisma.Decimal(value);
const zero = dec("0");
const day = () => new Date(`${businessDate()}T00:00:00.000Z`);

function plan(t: T, id: string) {
  return { organizationId: t.org.id, branchId: t.branch.id, businessDate: day(), description: "stock test", createdById: t.owner.id, reference: { type: "stock_document", id } };
}

test("stock in is posted at its cost: the inventory account rises by what the stock is worth (I3)", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    const id = randomUUID();
    const done = await runTx((tx) =>
      postWithStock(tx, {
        ...plan(t, id),
        doc: { type: "OPENING_STOCK", id },
        moves: [{ productId: product.id, warehouseId: t.warehouse.id, direction: "IN", quantity: dec("10"), unitCost: dec("6.1234"), movementType: "OPENING" }],
        lines: (moved) => [
          { role: "INVENTORY", debit: moved.in, credit: zero },
          { role: "OPENING_EQUITY", debit: zero, credit: moved.in },
        ],
      }),
    );
    assert.equal(done.moved.in.toFixed(2), "61.23");
    const journal = await prisma.journal.findFirstOrThrow({ where: { organizationId: t.org.id, docType: "OPENING_STOCK", docId: id }, include: { lines: true } });
    assert.deepEqual(journal.lines.map((l) => [Number(l.debit), Number(l.credit)]).sort(), [[0, 61.23], [61.23, 0]]);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: t.org.id } })).quantity.toFixed(4), "10.0000");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a journal that carries the wrong inventory amount is refused, and the stock move is not kept", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    const id = randomUUID();
    await assert.rejects(
      runTx((tx) =>
        postWithStock(tx, {
          ...plan(t, id),
          doc: { type: "OPENING_STOCK", id },
          moves: [{ productId: product.id, warehouseId: t.warehouse.id, direction: "IN", quantity: dec("10"), unitCost: dec("6"), movementType: "OPENING" }],
          lines: () => [
            { role: "INVENTORY", debit: dec("59.00"), credit: zero },
            { role: "OPENING_EQUITY", debit: zero, credit: dec("59.00") },
          ],
        }),
      ),
      /inventory/i,
    );
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: t.org.id } }), 0);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), 0);
  });
});

test("stock out is valued at the average; the journal's inventory credit is exactly that", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    const post = (id: string, direction: "IN" | "OUT", quantity: string, unitCost?: string) =>
      runTx((tx) =>
        postWithStock(tx, {
          ...plan(t, id),
          doc: { type: direction === "IN" ? "OPENING_STOCK" : "STOCK_ADJUSTMENT", id },
          moves: [{ productId: product.id, warehouseId: t.warehouse.id, direction, quantity: dec(quantity), unitCost: unitCost ? dec(unitCost) : undefined, movementType: direction === "IN" ? "OPENING" : "ADJUSTMENT" }],
          lines: (moved) =>
            direction === "IN"
              ? [{ role: "INVENTORY", debit: moved.in, credit: zero }, { role: "OPENING_EQUITY", debit: zero, credit: moved.in }]
              : [{ role: "INVENTORY_LOSS", debit: moved.out, credit: zero }, { role: "INVENTORY", debit: zero, credit: moved.out }],
        }),
      );
    await post(randomUUID(), "IN", "10", "3.3333");
    const out = await post(randomUUID(), "OUT", "4");
    assert.equal(out.moved.out.toFixed(2), "13.33", "4 x 3.3333 rounded to money");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a transfer is checked branch by branch: each branch's inventory moves by its own side", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    const branch2 = await prisma.branch.create({ data: { organizationId: t.org.id, name: "Second" } });
    const warehouse2 = await prisma.warehouse.create({ data: { organizationId: t.org.id, branchId: branch2.id, name: "W2" } });
    const stockIn = randomUUID();
    await runTx((tx) =>
      postWithStock(tx, {
        ...plan(t, stockIn),
        doc: { type: "OPENING_STOCK", id: stockIn },
        moves: [{ productId: product.id, warehouseId: t.warehouse.id, direction: "IN", quantity: dec("10"), unitCost: dec("5"), movementType: "OPENING" }],
        lines: (moved) => [{ role: "INVENTORY", debit: moved.in, credit: zero }, { role: "OPENING_EQUITY", debit: zero, credit: moved.in }],
      }),
    );
    const moves = [
      { productId: product.id, warehouseId: t.warehouse.id, direction: "OUT" as const, quantity: dec("4"), movementType: "TRANSFER_OUT" as const },
      { productId: product.id, warehouseId: warehouse2.id, branchId: branch2.id, direction: "IN" as const, quantity: dec("4"), unitCost: dec("5"), movementType: "TRANSFER_IN" as const },
    ];
    // both inventory lines on the same branch: the destination branch's stock rose but its inventory account did not
    const wrong = randomUUID();
    await assert.rejects(
      runTx((tx) =>
        postWithStock(tx, {
          ...plan(t, wrong),
          doc: { type: "TRANSFER", id: wrong },
          moves,
          lines: (moved) => [{ role: "INVENTORY", debit: moved.in, credit: zero }, { role: "INVENTORY", debit: zero, credit: moved.out }],
        }),
      ),
      /inventory/i,
    );
    const right = randomUUID();
    await runTx((tx) =>
      postWithStock(tx, {
        ...plan(t, right),
        doc: { type: "TRANSFER", id: right },
        moves,
        lines: (moved) => [{ role: "INVENTORY", branchId: branch2.id, debit: moved.in, credit: zero }, { role: "INVENTORY", debit: zero, credit: moved.out }],
      }),
    );
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
    const lines = await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "TRANSFER" } } });
    assert.deepEqual(lines.map((l) => l.branchId).sort(), [t.branch.id, branch2.id].sort(), "each line carries its own branch");
  });
});

test("with no stock moves it is an ordinary journal", async () => {
  await withTestOrg(async (t) => {
    const id = randomUUID();
    await runTx((tx) =>
      postWithStock(tx, {
        ...plan(t, id),
        doc: { type: "JOURNAL", id },
        moves: [],
        lines: () => [{ role: "CASH", debit: dec("5"), credit: zero }, { role: "OPENING_EQUITY", debit: zero, credit: dec("5") }],
      }),
    );
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: t.org.id } }), 0);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), 1);
  });
});
