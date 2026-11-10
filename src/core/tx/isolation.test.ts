import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { runTx } from "./run.ts";

// A plain read after a row lock: does it see what the transaction that held the lock committed? This is what two requests that
// spend the same wallet depend on. (The session variable @@transaction_isolation cannot tell: Prisma sets the level for the
// next transaction only. The behaviour can.)
async function readAfterLockWait(isolationLevel?: Prisma.TransactionIsolationLevel) {
  let seen: string | undefined;
  await withTestOrg(async (t) => {
    const customer = await prisma.customer.create({ data: { organizationId: t.org.id, name: "Locked", creditLimit: "0.00" } });
    const lock = (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT id FROM customers WHERE id = ${customer.id} FOR UPDATE`;
    const limit = (tx: Prisma.TransactionClient) => tx.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { creditLimit: true } }).then((row) => row.creditLimit?.toFixed(2));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holderLocked: () => void = () => undefined;
    const holderHasLock = new Promise<void>((resolve) => {
      holderLocked = resolve;
    });
    const holder = runTx(async (tx) => {
      await lock(tx);
      holderLocked();
      await held;
      await tx.customer.update({ where: { id: customer.id }, data: { creditLimit: "7.00" } });
    });
    await holderHasLock;
    const waiter = runTx(
      async (tx) => {
        await limit(tx); // the first read of this transaction happens before the lock wait
        await lock(tx);
        return limit(tx); // a plain read after the lock
      },
      isolationLevel ? { isolationLevel } : {},
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    await holder;
    seen = await waiter;
  });
  return seen;
}

test("by default a transaction is READ COMMITTED: after waiting for a row lock it sees what the other transaction committed", async () => {
  assert.equal(await readAfterLockWait(), "7.00");
});

test("a transaction that asks for REPEATABLE READ keeps its snapshot from before the wait", async () => {
  assert.equal(await readAfterLockWait(Prisma.TransactionIsolationLevel.RepeatableRead), "0.00");
});
