import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { prisma } from "../../lib/db/client.ts";
import { concurrently, withTestOrg } from "../../tests/helpers/index.ts";
import { RuleError } from "../errors/rule-error.ts";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "./index.ts";

// An operation written the way the posting modules write it today: read the key, replay or do the work,
// save the key. Its replay branch returns an empty shell (number and total null), the N24 problem.
function createInvoice(
  t: { org: { id: string }; owner: { id: string } },
  key: string,
  payload: unknown,
  counter: { runs: number },
) {
  return idempotentTransaction(async (tx) => {
    const requestHash = hashPayload(payload);
    const existing = await readIdempotency(tx, { organizationId: t.org.id, key, requestHash });
    if (existing === "mismatch") {
      throw new RuleError("This idempotency key was already used for a different request.", 409);
    }
    if (existing) {
      return { id: existing.entityId, replayed: true, number: null as string | null, total: null as string | null };
    }
    counter.runs += 1;
    const branch = await tx.branch.create({ data: { organizationId: t.org.id, name: `Invoice ${counter.runs}` } });
    await saveIdempotency(tx, {
      organizationId: t.org.id,
      userId: t.owner.id,
      key,
      requestHash,
      entityType: "branch",
      entityId: branch.id,
    });
    return { id: branch.id, replayed: false, number: "INV-2627-000042", total: "1234.50" };
  });
}

test("a repeated request gets the original answer back: the same id, number and total", async () => {
  await withTestOrg(async (t) => {
    const counter = { runs: 0 };
    const key = randomUUID();
    const first = await createInvoice(t, key, { items: [1, 2] }, counter);
    assert.equal(first.replayed, false);
    const again = await createInvoice(t, key, { items: [1, 2] }, counter);
    assert.deepEqual(again, { id: first.id, replayed: true, number: "INV-2627-000042", total: "1234.50" });
    assert.equal(counter.runs, 1);
    assert.equal(await prisma.branch.count({ where: { organizationId: t.org.id, name: { startsWith: "Invoice" } } }), 1);
  });
});

test("the same key with a different request is refused with 409, and nothing new is saved", async () => {
  await withTestOrg(async (t) => {
    const counter = { runs: 0 };
    const key = randomUUID();
    await createInvoice(t, key, { items: [1] }, counter);
    await assert.rejects(createInvoice(t, key, { items: [1, 2] }, counter), (error: unknown) => error instanceof RuleError && error.status === 409);
    assert.equal(counter.runs, 1);
  });
});

test("the order of the fields in the request does not change its hash", () => {
  assert.equal(hashPayload({ a: 1, b: { c: [1, 2], d: "x" } }), hashPayload({ b: { d: "x", c: [1, 2] }, a: 1 }));
  assert.notEqual(hashPayload({ a: 1 }), hashPayload({ a: 2 }));
});

test("ten parallel requests with one key create one invoice, and all ten get the same full answer", async () => {
  await withTestOrg(async (t) => {
    const counter = { runs: 0 };
    const key = randomUUID();
    const answers = await concurrently(10, () => createInvoice(t, key, { items: [1] }, counter));
    assert.equal(new Set(answers.map((answer) => answer.id)).size, 1);
    assert.equal(answers.every((answer) => answer.number === "INV-2627-000042" && answer.total === "1234.50"), true);
    assert.equal(answers.filter((answer) => !answer.replayed).length, 1);
    assert.equal(await prisma.branch.count({ where: { organizationId: t.org.id, name: { startsWith: "Invoice" } } }), 1);
  });
});

test("a key saved before answers were stored still replays with the module's own shape", async () => {
  await withTestOrg(async (t) => {
    const counter = { runs: 0 };
    const key = randomUUID();
    const branch = await prisma.branch.create({ data: { organizationId: t.org.id, name: "Invoice old" } });
    await prisma.idempotencyKey.create({
      data: { organizationId: t.org.id, userId: t.owner.id, key, requestHash: hashPayload({ items: [1] }), entityType: "branch", entityId: branch.id },
    });
    const answer = await createInvoice(t, key, { items: [1] }, counter);
    assert.deepEqual(answer, { id: branch.id, replayed: true, number: null, total: null });
    assert.equal(counter.runs, 0);
  });
});

test("the stored answer is plain JSON: decimals and dates survive as text", async () => {
  await withTestOrg(async (t) => {
    const key = randomUUID();
    await idempotentTransaction(async (tx) => {
      const requestHash = hashPayload("json");
      await saveIdempotency(tx, { organizationId: t.org.id, userId: t.owner.id, key, requestHash, entityType: "x", entityId: t.branch.id });
      return { id: t.branch.id, replayed: false, at: new Date("2026-11-08T00:00:00.000Z"), nested: { total: "5.00" } };
    });
    const row = await prisma.idempotencyKey.findFirstOrThrow({ where: { organizationId: t.org.id, key } });
    assert.deepEqual(row.response, { id: t.branch.id, replayed: false, at: "2026-11-08T00:00:00.000Z", nested: { total: "5.00" } });
  });
});

// There is one idempotency implementation: nothing else touches the table or hashes request payloads.
const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const sources = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
  .filter((entry) => /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry))
  .map((entry) => entry.split(sep).join("/"));

test("only src/core/idempotency touches the idempotency_keys table", () => {
  const offenders = sources
    .filter((file) => !file.startsWith("core/idempotency/") && !file.startsWith("tests/"))
    .filter((file) => /idempotencyKey\.(find|create|update|upsert|delete)/.test(readFileSync(join(srcRoot, file), "utf8")));
  assert.deepEqual(offenders, []);
  assert.equal(sources.includes("modules/inventory/idempotency.ts"), false);
});
