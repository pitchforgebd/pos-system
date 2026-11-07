import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Static rules for dates (P01 task 1). A UTC slice of "now" is the wrong business day after 18:00 UTC
// (midnight in Dhaka), and a hand-written date regex lets 2026-02-31 through to a 500 error.

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((entry) => /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry))
    .map((entry) => entry.split(sep).join("/"))
    .sort();
}

const files = sourceFiles(srcRoot);

function offenders(pattern: RegExp, only?: (file: string) => boolean) {
  return files
    .filter((file) => (only ? only(file) : true))
    .filter((file) => pattern.test(readFileSync(join(srcRoot, file), "utf8")))
    .map((file) => file);
}

test("the source is found", () => {
  assert.equal(files.length > 200, true, `found ${files.length} source files`);
});

test("no source file builds a date string from toISOString().slice(0, 10)", () => {
  assert.deepEqual(offenders(/toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/), []);
  // The seed scripts are outside src but run the same posting code.
  const seedFiles = ["seed.ts", "demo.ts"].filter((name) =>
    /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/.test(readFileSync(join(srcRoot, "..", "prisma", name), "utf8")),
  );
  assert.deepEqual(seedFiles, []);
});

test("no API route validates a date with a hand-written regex", () => {
  assert.deepEqual(offenders(/regex\(\s*\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//, (file) => file.startsWith("app/api/")), []);
});
