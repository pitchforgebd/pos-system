import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// next.config.ts imports "./src/lib/security/headers" without an extension, which plain Node cannot
// load, so the config is checked as text. The real response header is checked against a production
// build in the P00 practice run (docs/meridian-v2/v2/phases/P00_BASELINE.md).
const source = readFileSync(new URL("../../../next.config.ts", import.meta.url), "utf8");

test("the app does not announce itself with an x-powered-by header", () => {
  assert.match(source, /^\s*poweredByHeader:\s*false\s*,/m);
});
