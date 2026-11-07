import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { concurrentlySettled, withTestOrg } from "../../tests/helpers/index.ts";
import { RuleError } from "../errors/rule-error.ts";
import { stockLockOrder } from "./lock-order.ts";
import { isDeadlock, runTx } from "./run.ts";

function prismaError(code: string, message = "boom") {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test" });
}

test("runTx runs the function in a transaction and returns its value", async () => {
  await withTestOrg(async (t) => {
    const value = await runTx(async (tx) => {
      await tx.branch.create({ data: { organizationId: t.org.id, name: "Second" } });
      return tx.branch.count({ where: { organizationId: t.org.id } });
    });
    assert.equal(value, 2);
  });
});

test("runTx rolls the transaction back when the function throws", async () => {
  await withTestOrg(async (t) => {
    await assert.rejects(
      runTx(async (tx) => {
        await tx.branch.create({ data: { organizationId: t.org.id, name: "Never saved" } });
        throw new RuleError("no");
      }),
      RuleError,
    );
    assert.equal(await prisma.branch.count({ where: { organizationId: t.org.id } }), 1);
  });
});

test("a deadlock or write conflict (P2034) is retried, up to three times", async () => {
  let attempts = 0;
  const result = await runTx(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw prismaError("P2034", "Transaction failed due to a write conflict or a deadlock.");
      }
      return "ok";
    },
    { backoffMs: 1 },
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 3);

  let always = 0;
  const error = prismaError("P2034");
  await assert.rejects(
    runTx(
      async () => {
        always += 1;
        throw error;
      },
      { backoffMs: 1 },
    ),
    (thrown: unknown) => thrown === error,
  );
  assert.equal(always, 4, "one try plus three retries");
});

test("only retryable errors are retried: a rule refusal or another database error is thrown at once", async () => {
  for (const error of [new RuleError("closed"), new Error("plain"), prismaError("P2025"), prismaError("P2002")]) {
    let attempts = 0;
    await assert.rejects(
      runTx(
        async () => {
          attempts += 1;
          throw error;
        },
        { backoffMs: 1 },
      ),
      (thrown: unknown) => thrown === error,
    );
    assert.equal(attempts, 1, String(error));
  }
});

test("the caller can mark more errors as retryable (the idempotency-key race)", async () => {
  const race = prismaError("P2002", "Unique constraint failed on idempotency_keys");
  let attempts = 0;
  const result = await runTx(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw race;
      }
      return "replayed";
    },
    { backoffMs: 1, retryIf: (error) => error === race },
  );
  assert.equal(result, "replayed");
  assert.equal(attempts, 2);
});

test("isDeadlock recognises the Prisma code and the MySQL error text", () => {
  assert.equal(isDeadlock(prismaError("P2034")), true);
  assert.equal(isDeadlock(prismaError("P2010", "Raw query failed. Code: `1213`. Message: `Deadlock found when trying to get lock`")), true);
  assert.equal(isDeadlock(new Error("ER_LOCK_DEADLOCK")), true);
  assert.equal(isDeadlock(new Error("something else")), false);
  assert.equal(isDeadlock("P2034"), false);
});

test("a real deadlock (two transactions locking two rows in opposite order) is retried and both finish", async () => {
  await withTestOrg(async (t) => {
    const groups = await prisma.accountGroup.findMany({ where: { organizationId: t.org.id }, orderBy: { code: "asc" }, take: 2 });
    const [first, second] = [groups[0].id, groups[1].id];
    const lock = (tx: Prisma.TransactionClient, id: string) => tx.$queryRaw`SELECT id FROM account_groups WHERE id = ${id} FOR UPDATE`;

    let attempts = 0;
    let held = 0;
    let bothHold: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      bothHold = resolve;
    });
    const work = async (own: string, other: string) =>
      runTx(
        async (tx) => {
          attempts += 1;
          await lock(tx, own);
          if (held < 2) {
            held += 1;
            if (held === 2) {
              bothHold();
            }
            await barrier; // both hold their first lock before either asks for the second
          }
          await lock(tx, other);
          return own;
        },
        { backoffMs: 5 },
      );

    const results = await concurrentlySettled(2, (index) => (index === 0 ? work(first, second) : work(second, first)));
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
    assert.equal(attempts >= 3, true, `a deadlock victim must have been retried (attempts: ${attempts})`);
  });
});

test("a transaction may run longer than Prisma's own 5 second default, and the limits can be changed", async () => {
  const started = Date.now();
  await runTx(async (tx) => tx.$queryRaw`SELECT SLEEP(5.5)`);
  assert.equal(Date.now() - started >= 5400, true);
  await assert.rejects(runTx(async (tx) => tx.$queryRaw`SELECT SLEEP(1.5)`, { timeoutMs: 400 }));
});

test("stockLockOrder sorts by product, then warehouse, then variant, with missing values last, without changing its input", () => {
  const rows = [
    { productId: "b", warehouseId: "w2", variantId: null as string | null },
    { productId: "a", warehouseId: "w2", variantId: "v1" as string | null },
    { productId: "a", warehouseId: "w1", variantId: null as string | null },
    { productId: "a", warehouseId: "w1", variantId: "v1" as string | null },
    { productId: "a", warehouseId: null, variantId: null as string | null },
  ];
  const copy = [...rows];
  const sorted = stockLockOrder(rows).map((row) => `${row.productId}/${row.warehouseId}/${row.variantId}`);
  assert.deepEqual(sorted, ["a/w1/v1", "a/w1/null", "a/w2/v1", "a/null/null", "b/w2/null"]);
  assert.deepEqual(rows, copy);
});

// Every transaction in the application goes through runTx: the same limits, the same retries.
const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const sources = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
  .filter((entry) => /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry))
  .map((entry) => entry.split(sep).join("/"));

test("no module or route opens a transaction directly", () => {
  const direct = sources
    .filter((file) => file !== "core/tx/run.ts" && !file.startsWith("tests/"))
    .filter((file) => readFileSync(join(srcRoot, file), "utf8").includes("$transaction("));
  assert.deepEqual(direct, []);
});
