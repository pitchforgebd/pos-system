import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { buildAgriDay } from "../../tests/golden/agri-day.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { workbook } from "../../lib/export/xlsx.ts";

// P11: the report route. Reading needs reports.view, an export needs reports.export (and is audited), profit reports need reports.profit, every
// branch together needs reports.all_branches; the .xlsx is a real zip with the cells in it.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function caller(t: T) {
  const { openSession } = await import("../auth/session.ts");
  const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
  return (route: Handler, key: string, query = "") =>
    route(new Request(`http://localhost/api/v1/reports/run/${key}${query}`, { headers: { cookie: `meridian_session=${token}`, origin: "http://localhost" } }), { params: Promise.resolve({ key }) });
}

/** The entries of a zip, read from its central directory. */
function unzip(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    const method = bytes.readUInt16LE(at + 10);
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(dataStart, dataStart + size);
    files.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString("utf8"));
    at += 46 + nameLength;
  }
  return files;
}

test("the workbook is a valid zip: the sheets and their cells (numbers as numbers, Bangla and markup characters kept)", () => {
  const files = unzip(workbook([{ name: "Cash / ক্যাশ", rows: [["Item", "Amount"], ["Tea & <snacks>", 12.5], ["চা", null]] }, { name: "Second", rows: [["x"]] }]));
  assert.deepEqual([...files.keys()].sort(), ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
  assert.match(files.get("xl/workbook.xml") ?? "", /name="Cash   ক্যাশ"/);
  const sheet = files.get("xl/worksheets/sheet1.xml") ?? "";
  assert.match(sheet, /<c r="B2"><v>12.5<\/v><\/c>/);
  assert.match(sheet, /Tea &amp; &lt;snacks&gt;/);
  assert.match(sheet, /চা/);
});

test("the report route: json, csv and xlsx; export and profit and all-branches each need their permission; an export is audited", async () => {
  const route = (await import("../../app/api/v1/reports/run/[key]/route.ts")).GET as Handler;
  await withTestOrg(async (t) => {
    const { day } = await buildAgriDay(t);
    const get = await caller(t);
    const json = await get(route, "cash", `?from=${day}&to=${day}`);
    assert.equal(json.status, 200);
    const body = (await json.json()) as { data: { key: string; identities: Array<{ ok: boolean }> } };
    assert.deepEqual([body.data.key, body.data.identities.every((check) => check.ok)], ["cash", true]);
    assert.equal((await get(route, "nothing")).status, 404);
    assert.equal((await get(route, "cash", "?from=2026-02-31")).status, 200, "a bad date falls back to today rather than failing");
    assert.equal((await get(route, "cash", `?from=${day}&to=2000-01-01`)).status, 422, "from after to");
    assert.equal((await get(route, "cash", `?branch=${randomUUID()}`)).status, 422, "a branch that is not the user's");

    const csv = await get(route, "sales", `?from=${day}&to=${day}&format=csv&lang=bn`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-disposition") ?? "", new RegExp(`sales-${day}\\.csv`));
    const bytes = Buffer.from(await csv.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "a byte-order mark so Excel reads the Bangla");
    const text = bytes.toString("utf8");
    assert.ok(text.startsWith("﻿বিক্রি"), "the Bangla title");
    assert.match(text, /ইনভয়েস/);
    const xlsx = await get(route, "stock", `?from=${day}&to=${day}&format=xlsx`);
    assert.equal(xlsx.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const files = unzip(Buffer.from(await xlsx.arrayBuffer()));
    assert.ok((files.get("xl/worksheets/sheet2.xml") ?? "").includes("Urea bag"));
    assert.equal(await prisma.auditLog.count({ where: { organizationId: t.org.id, module: "reports", action: "export" } }), 2, "both exports are in the audit log");
  });
  await withTestOrg(
    async (t) => {
      const get = await caller(t);
      assert.equal((await get(route, "cash")).status, 200);
      assert.equal((await get(route, "cash", "?format=csv")).status, 403, "no export permission");
      assert.equal((await get(route, "profit")).status, 403, "no profit permission");
      assert.equal((await get(route, "cash", "?branch=all")).status, 422, "no all-branches permission");
    },
    { permissions: ["reports.view"] },
  );
});
