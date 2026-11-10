import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { runTx } from "../../core/tx/run.ts";
import { concurrentlySettled, concurrently, withTestOrg } from "../../tests/helpers/index.ts";
import { allocateNumber, formatDocumentNumber } from "./numbers.ts";

const allocate = (organizationId: string, documentType: "INV" | "PUR" | "RET" | "VCH" | "PAY", businessDate: string) =>
  // 50 transactions start at once, more than the pool holds; the test checks the numbers, not the wait for a connection.
  runTx((tx) => allocateNumber(tx, { organizationId, documentType, businessDate }), { maxWaitMs: 60_000, timeoutMs: 60_000 });

test("a number is the type, the fiscal-year label and a six-digit counter: INV-2627-000001", async () => {
  await withTestOrg(async (t) => {
    assert.equal(await allocate(t.org.id, "INV", "2026-10-01"), "INV-2627-000001");
    assert.equal(await allocate(t.org.id, "INV", "2026-10-02"), "INV-2627-000002");
    assert.equal(formatDocumentNumber("PUR", 2627, 42), "PUR-2627-000042");
    assert.equal(formatDocumentNumber("RET", 1, 7), "RET-0001-000007");
  });
});

test("the fiscal year runs July to June: 30 June is the old year, 1 July the new one, and each starts again at 1", async () => {
  await withTestOrg(async (t) => {
    assert.equal(await allocate(t.org.id, "INV", "2027-06-30"), "INV-2627-000001");
    assert.equal(await allocate(t.org.id, "INV", "2027-07-01"), "INV-2728-000001");
    assert.equal(await allocate(t.org.id, "INV", "2027-12-31"), "INV-2728-000002");
    // a late entry dated in the old year continues the old year's counter, not the new one
    assert.equal(await allocate(t.org.id, "INV", "2027-06-15"), "INV-2627-000002");
    assert.equal(await allocate(t.org.id, "INV", "2026-01-01"), "INV-2526-000001");
  });
});

test("each document type and each organization counts on its own", async () => {
  await withTestOrg(async (a) => {
    await withTestOrg(async (b) => {
      assert.equal(await allocate(a.org.id, "INV", "2026-10-01"), "INV-2627-000001");
      assert.equal(await allocate(a.org.id, "PUR", "2026-10-01"), "PUR-2627-000001");
      assert.equal(await allocate(a.org.id, "INV", "2026-10-01"), "INV-2627-000002");
      assert.equal(await allocate(b.org.id, "INV", "2026-10-01"), "INV-2627-000001", "another organization starts at 1");
    });
  });
});

test("an organization that starts its year in January gets calendar-year labels", async () => {
  await withTestOrg(async (t) => {
    await prisma.organization.update({ where: { id: t.org.id }, data: { fiscalYearStartMonth: 1 } });
    assert.equal(await allocate(t.org.id, "INV", "2026-12-31"), "INV-2626-000001");
    assert.equal(await allocate(t.org.id, "INV", "2027-01-01"), "INV-2727-000001");
  });
});

test("fifty parallel requests get fifty different numbers with no gap", async () => {
  await withTestOrg(async (t) => {
    const numbers = await concurrently(50, () => allocate(t.org.id, "INV", "2026-10-01"));
    const counters = numbers.map((number) => Number(number.slice(-6))).sort((x, y) => x - y);
    assert.equal(new Set(numbers).size, 50);
    assert.deepEqual(counters, Array.from({ length: 50 }, (_, index) => index + 1));
    const row = await prisma.documentSequence.findFirstOrThrow({ where: { organizationId: t.org.id, documentType: "INV" } });
    assert.equal(row.lastValue, 50);
    assert.equal(row.fiscalYear, 2627);
  });
});

test("a number taken in a transaction that rolls back is not lost: the next request gets it (no gap)", async () => {
  await withTestOrg(async (t) => {
    assert.equal(await allocate(t.org.id, "INV", "2026-10-01"), "INV-2627-000001");
    await assert.rejects(
      runTx(async (tx) => {
        assert.equal(await allocateNumber(tx, { organizationId: t.org.id, documentType: "INV", businessDate: "2026-10-01" }), "INV-2627-000002");
        throw new Error("the sale failed after the number was taken");
      }),
      /the sale failed/,
    );
    assert.equal(await allocate(t.org.id, "INV", "2026-10-01"), "INV-2627-000002", "the number came back");
  });
});

test("parallel requests across a year boundary and two types still never repeat a number", async () => {
  await withTestOrg(async (t) => {
    const jobs = Array.from({ length: 30 }, (_, index) => () => allocate(t.org.id, index % 2 === 0 ? "INV" : "PUR", index % 3 === 0 ? "2027-07-01" : "2027-06-30"));
    const settled = await concurrentlySettled(jobs.length, (index) => jobs[index]());
    assert.deepEqual(settled.filter((r) => r.status === "rejected"), []);
    const numbers = settled.map((r) => (r.status === "fulfilled" ? r.value : ""));
    assert.equal(new Set(numbers).size, 30, "no number was handed out twice");
  });
});

test("the allocator takes a business date, not a year: no caller works the year out itself", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join, sep } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => f.split(sep).join("/"));
  const offenders = files.filter((file) => /documentYear/.test(readFileSync(join(root, file), "utf8")));
  assert.deepEqual(offenders, []);
  const callers = files.filter((file) => /allocateNumber\(/.test(readFileSync(join(root, file), "utf8")) && file !== "modules/documents/numbers.ts");
  for (const file of callers) {
    const text = readFileSync(join(root, file), "utf8");
    const calls = [...text.matchAll(/allocateNumber\(tx, \{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    assert.ok(calls.length > 0, file);
    for (const call of calls) {
      assert.match(call, /businessDate:/, `${file}: allocateNumber needs the document's businessDate`);
      assert.doesNotMatch(call, /\byear:/, `${file}: no year`);
    }
  }
});
