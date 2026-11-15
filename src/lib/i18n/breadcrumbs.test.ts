import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { translateNav } from "./nav.ts";

// P13: the path at the top of every page (Home / Sales / INV-...) is written in the language of the screen. A label a page puts there has a Bangla text.

const root = fileURLToPath(new URL("../../app", import.meta.url));
const SAME_IN_BOTH = new Set(["IMEI", "Take-off", "VAT", "CRM", "SMS"]);

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? pages(path) : entry.name === "page.tsx" ? [path] : [];
  });
}

test("every breadcrumb label of every page has a Bangla text", () => {
  const missing = new Set<string>();
  for (const file of pages(root)) {
    const text = readFileSync(file, "utf8");
    for (const block of text.matchAll(/breadcrumbs=\{\[([^\]]*)\]\}/g)) {
      for (const label of block[1].matchAll(/label:\s*"([^"]+)"/g)) {
        if (!SAME_IN_BOTH.has(label[1]) && translateNav("bn", label[1]) === label[1]) {
          missing.add(label[1]);
        }
      }
    }
  }
  assert.deepEqual([...missing].sort(), [], "breadcrumb labels with no Bangla text (add them to src/lib/i18n/nav.ts)");
});
