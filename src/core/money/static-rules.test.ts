import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Money has one home: src/core/money. A server module that defines its own money() or zero() has a copy
// that can round differently, and the old inventory/money.ts must not come back. (Client components keep
// their own bigint-cents helpers for display; they never touch Prisma.)

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const files = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
  .filter((entry) => /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry))
  .map((entry) => entry.split(sep).join("/"))
  .sort();

function offenders(pattern: RegExp, only: (file: string) => boolean = () => true) {
  return files.filter((file) => !file.startsWith("core/money/") && only(file) && pattern.test(readFileSync(join(srcRoot, file), "utf8")));
}

test("no module defines its own money, zero or decimalString helper", () => {
  assert.deepEqual(offenders(/^\s*(?:export\s+)?function\s+(?:money|zero|moneyText|decimalString|parseMoney|parseQuantity)\s*\(/m, (file) => file.startsWith("modules/")), []);
});

test("nothing imports the old modules/inventory/money file", () => {
  assert.deepEqual(offenders(/modules\/inventory\/money/), []);
  assert.equal(files.includes("modules/inventory/money.ts"), false);
});
