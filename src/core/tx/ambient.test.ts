import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { basePrisma, prisma } from "../../lib/db/client.ts";
import { concurrently, withTestOrg } from "../../tests/helpers/index.ts";
import { RuleError } from "../errors/rule-error.ts";
import { runTx } from "./run.ts";

// Inside runTx the shared `prisma` client is that transaction ("ambient" transaction). A route can open one
// transaction and every service it calls, and the audit row, joins it. A service's own runTx becomes a savepoint.

const count = (organizationId: string, name: string) => basePrisma.branch.count({ where: { organizationId, name } });

test("inside runTx the shared client is the transaction: an error rolls everything back, success commits", async () => {
  await withTestOrg(async (t) => {
    await assert.rejects(
      runTx(async () => {
        await prisma.branch.create({ data: { organizationId: t.org.id, name: "lost" } });
        throw new RuleError("no");
      }),
      RuleError,
    );
    assert.equal(await count(t.org.id, "lost"), 0);

    await runTx(async () => {
      await prisma.branch.create({ data: { organizationId: t.org.id, name: "kept" } });
    });
    assert.equal(await count(t.org.id, "kept"), 1);
  });
});

test("the transaction sees its own writes through the shared client; other connections do not until it commits", async () => {
  await withTestOrg(async (t) => {
    await runTx(async () => {
      await prisma.branch.create({ data: { organizationId: t.org.id, name: "inside" } });
      assert.equal(await prisma.branch.count({ where: { organizationId: t.org.id, name: "inside" } }), 1);
      assert.equal(await count(t.org.id, "inside"), 0, "another connection must not see an uncommitted row");
    });
    assert.equal(await count(t.org.id, "inside"), 1);
  });
});

test("a runTx inside a runTx joins it: when the outer one fails, inner and outer writes are undone together", async () => {
  await withTestOrg(async (t) => {
    await assert.rejects(
      runTx(async () => {
        await prisma.branch.create({ data: { organizationId: t.org.id, name: "outer" } });
        const inner = await runTx(async () => {
          await prisma.branch.create({ data: { organizationId: t.org.id, name: "inner" } });
          return "inner done";
        });
        assert.equal(inner, "inner done");
        throw new RuleError("the outer work failed");
      }),
      RuleError,
    );
    assert.equal(await count(t.org.id, "outer"), 0);
    assert.equal(await count(t.org.id, "inner"), 0);

    await runTx(async () => {
      await prisma.branch.create({ data: { organizationId: t.org.id, name: "outer" } });
      await runTx(async () => {
        await prisma.branch.create({ data: { organizationId: t.org.id, name: "inner" } });
      });
    });
    assert.equal(await count(t.org.id, "outer"), 1);
    assert.equal(await count(t.org.id, "inner"), 1);
  });
});

test("an error from a nested call reaches the outermost runTx, which retries the whole function", async () => {
  await withTestOrg(async (t) => {
    const race = new Error("race");
    let attempts = 0;
    await runTx(
      async () => {
        attempts += 1;
        await prisma.branch.create({ data: { organizationId: t.org.id, name: `try-${attempts}` } });
        await runTx(async () => {
          if (attempts === 1) {
            throw race;
          }
        });
      },
      { retryIf: (error) => error === race, backoffMs: 1 },
    );
    assert.equal(attempts, 2);
    assert.equal(await count(t.org.id, "try-1"), 0, "the first try was rolled back as a whole");
    assert.equal(await count(t.org.id, "try-2"), 1);
  });
});

test("concurrent transactions each have their own connection, and one transaction keeps one", async () => {
  const ids = await concurrently(6, () =>
    runTx(async () => {
      const first = await prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT CONNECTION_ID() AS id`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const second = await prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT CONNECTION_ID() AS id`);
      assert.equal(first[0].id, second[0].id);
      return String(first[0].id);
    }),
  );
  assert.equal(new Set(ids).size, 6);
});

test("outside runTx the shared client is the ordinary client, and $disconnect and friends still work", async () => {
  const before = await prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT 1 AS id`);
  assert.equal(before.length, 1);
  assert.equal(typeof prisma.$disconnect, "function");
  await runTx(async () => {
    assert.equal(typeof prisma.$disconnect, "function");
    assert.equal(typeof prisma.$on, "function");
  });
});
