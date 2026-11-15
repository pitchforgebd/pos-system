import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// P13 (the "no English left on the listed screens" test): the screens below were moved to the text catalog (src/lib/i18n/messages). A text a person reads
// that is written straight into one of these files, in English, is a screen that has slipped back. This is a source check, not a browser check: it finds
// JSX text, and the text attributes (placeholder, aria-label, title, label, alt), that hold English words. A screen is added to the list when it is done.

const root = fileURLToPath(new URL("../../", import.meta.url));

const LISTED = [
  "app/(auth)/login/page.tsx",
  "app/(auth)/forgot-password/page.tsx",
  "app/(auth)/reset-password/page.tsx",
  "app/(auth)/layout.tsx",
  "app/(dashboard)/dashboard/page.tsx",
  "components/dashboard/today.tsx",
  "components/dashboard/dashboard-filters.tsx",
  "components/pos/register.tsx",
  "components/layout/header.tsx",
  "components/layout/shell.tsx",
  "components/layout/language-switch.tsx",
  "components/ui/pagination.tsx",
  "components/ui/confirm-dialog.tsx",
  "components/ui/modal.tsx",
  "components/ui/drawer.tsx",
  "components/ui/quantity-input.tsx",
  "components/ui/calendar.tsx",
  "components/ui/date-picker.tsx",
  "components/ui/date-range-picker.tsx",
  "app/(dashboard)/sales/[id]/page.tsx",
  "app/(dashboard)/products/page.tsx",
  "components/catalog/product-photo.tsx",
  "app/(dashboard)/sales/page.tsx",
  "app/(dashboard)/sales/invoices/page.tsx",
  "app/(dashboard)/sales/due-dates/page.tsx",
  "app/(dashboard)/sales/returns/page.tsx",
  "app/(dashboard)/pos/open-tickets/page.tsx",
  "components/sales/sales-table.tsx",
  "components/sales/ticket-list.tsx",
  "components/returns/return-form.tsx",
  "app/(dashboard)/orders/page.tsx",
  "app/(dashboard)/orders/new/page.tsx",
  "app/(dashboard)/orders/[id]/page.tsx",
  "app/(dashboard)/orders/[id]/edit/page.tsx",
  "app/(dashboard)/orders/[id]/print/page.tsx",
  "app/(dashboard)/quotations/page.tsx",
  "components/orders/order-actions.tsx",
  "components/orders/order-form.tsx",
  "components/returns/receiptless-form.tsx",
];

// words that are the same in both languages, brand names and technical terms
const ALLOWED = new Set(["SKU", "IMEI", "VAT", "F2", "F4", "F6", "F9", "F10", "A4", "Ctrl", "K", "Walk", "in", "Meridian", "Bangla", "English", "POS", "ID", "OK"]);

function englishWords(text: string) {
  return (text.match(/[A-Za-z]{2,}/g) ?? []).filter((word) => !ALLOWED.has(word));
}

test("the listed screens carry no English text of their own", () => {
  const found: string[] = [];
  for (const file of LISTED) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    let inImport = false;
    lines.forEach((line, index) => {
      const code = line.trim();
      // the names inside a multi-line import are code, not text
      if (inImport) {
        inImport = !code.startsWith("}");
        return;
      }
      if (code.startsWith("import {") && !code.includes(" from ")) {
        inImport = true;
        return;
      }
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*") || code.startsWith("import ") || code.startsWith("{/*")) {
        return;
      }
      const hits: string[] = [];
      // a text attribute written as a plain string
      for (const match of line.matchAll(/\b(placeholder|aria-label|title|alt)="([^"{}]+)"/g)) {
        hits.push(...englishWords(match[2]));
      }
      // JSX text between tags on one line: >Some words<
      for (const match of line.matchAll(/<[A-Za-z][^<>]*>([^<>{}=]+)<\//g)) {
        if (/^[\s /·|—:()\d.,-]*$/.test(match[1])) {
          continue;
        }
        hits.push(...englishWords(match[1]));
      }
      // a line that is only text (the text of a button or a label on its own line)
      if (/^[A-Z][a-z]+( [A-Za-z0-9,.'()&/:?!-]+)+$/.test(code) && !/^(return|const|let|if|else|case|default|export|function|type|void|await|break|continue)\b/.test(code)) {
        hits.push(...englishWords(code));
      }
      if (hits.length > 0) {
        found.push(`${file}:${index + 1}: ${hits.join(" ")}  <-  ${code.slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(found, [], "English text written into a listed screen; put it in the catalog");
});
