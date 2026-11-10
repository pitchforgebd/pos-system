import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { accountGroups, accounts } from "../../../prisma/chart-of-accounts.ts";

// No code writes an account number (B8). The chart (prisma/chart-of-accounts.ts) is where numbers live; everything else
// asks for a role (accountFor) or a kind. A number written in code goes stale the day the owner renumbers the chart, and
// it silently posts to the wrong account. Group numbers (1000 assets ... 6000 expenses) are the same kind of thing and live
// in one file, src/core/ledger/groups.ts.

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const files = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
  .filter((entry) => /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry))
  .map((entry) => entry.split(sep).join("/"))
  .sort();

// Display-only sample data of the reference screens; nothing here is ever posted.
const SAMPLE_DATA = ["lib/mock/", "lib/screens/"];
const ALLOWED = new Set(["core/ledger/groups.ts"]);
// The one 4-digit string that is not an account: MySQL's deadlock error number.
const NOT_AN_ACCOUNT = new Set(["1213"]);

const literal = /(["'`])([1-6][0-9]{3})\1/g;

function hits(file: string) {
  const text = readFileSync(join(srcRoot, file), "utf8");
  return [...text.matchAll(literal)].map((match) => match[2]).filter((code) => !NOT_AN_ACCOUNT.has(code));
}

test("no source file writes an account or group number as a string", () => {
  const offenders = files
    .filter((file) => !ALLOWED.has(file) && !SAMPLE_DATA.some((prefix) => file.startsWith(prefix)))
    .flatMap((file) => {
      const found = hits(file);
      return found.length > 0 ? [`${file}: ${[...new Set(found)].join(", ")}`] : [];
    });
  assert.deepEqual(offenders, []);
});

test("the group numbers in code are exactly the groups of the chart", () => {
  const text = readFileSync(join(srcRoot, "core/ledger/groups.ts"), "utf8");
  const inCode = [...new Set(hits("core/ledger/groups.ts"))].sort();
  assert.deepEqual(inCode, accountGroups.map((group) => group.code).sort());
  assert.ok(text.includes("GROUP"));
  // and every account of the chart sits in one of them
  assert.deepEqual(accounts.filter((account) => !accountGroups.some((group) => group.code === account.groupCode)), []);
});

test("code does not build account numbers from pieces either (no startsWith or regex on a code)", () => {
  const offenders = files
    .filter((file) => !SAMPLE_DATA.some((prefix) => file.startsWith(prefix)))
    .filter((file) => /code:\s*\{\s*startsWith|code\.startsWith\(|\.code\)\.test\(|\^12|\/\^1[0-9]/.test(readFileSync(join(srcRoot, file), "utf8")));
  assert.deepEqual(offenders, []);
});
