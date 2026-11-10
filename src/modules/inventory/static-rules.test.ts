import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// I18 for the stock documents (P03 DoD): documents.ts writes headers and nothing else (it only reads the ledger, to list documents). The stock ledger, the stock balance, the lots
// and the journal are written by the stock engine and the posting engine (postWithStock), never from here.
const text = readFileSync(fileURLToPath(new URL("./documents.ts", import.meta.url)), "utf8");

test("documents.ts does not write stock or journals itself", () => {
  const forbidden = [
    /\.(stockLedger|stockBalance|journal|journalLine|expiryBatch)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
    /\$executeRaw/,
    /\bapplyMovement\s*\(/,
    /\bpost\s*\(/,
    /\bpostBalancedJournal\s*\(/,
  ];
  const found = forbidden.filter((pattern) => pattern.test(text)).map(String);
  assert.deepEqual(found, []);
});

test("every stock document goes through postWithStock", () => {
  assert.equal((text.match(/postWithStock\(/g) ?? []).length >= 2, true, "the runner and the transfer");
});
