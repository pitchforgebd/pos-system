import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Every write a browser form sends goes through useSubmit / useFormSubmit (src/lib/client). They own the
// Idempotency-Key (one per attempt, kept across a retry), the double-click lock, the timeout and the message when
// the network is down. A component that builds its own fetch brings back the sale that is saved twice.

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
const files = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
  .filter((entry) => /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry))
  .map((entry) => entry.split(sep).join("/"))
  .filter((file) => !file.startsWith("app/api/"))
  .sort();
const read = (file: string) => readFileSync(join(srcRoot, file), "utf8");

// The two files that are allowed to know about keys and uuids.
const OWNERS = new Set(["lib/client/submit-core.ts", "lib/client/uuid.ts"]);

// Public pages with no money and no stock, which sign in or reset a password. They do a full page navigation on
// purpose (a new session starts a clean app). The list can only shrink: a page that moves to useSubmit must leave it.
const PUBLIC_PAGES = ["app/(auth)/forgot-password/page.tsx", "app/(auth)/login/page.tsx", "app/(auth)/reset-password/page.tsx"];

/** The text of every fetch(...) call in a file (balanced brackets, strings skipped). */
function fetchCalls(text: string) {
  const calls: string[] = [];
  for (const match of text.matchAll(/\bfetch\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < text.length; i += 1) {
      const c = text[i];
      if (c === '"' || c === "'" || c === "`") {
        for (i += 1; i < text.length && text[i] !== c; i += 1) {
          if (text[i] === "\\") i += 1;
        }
      } else if (c === "(") depth += 1;
      else if (c === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    calls.push(text.slice(open, end + 1));
  }
  return calls;
}

const writes = (file: string) => fetchCalls(read(file)).filter((call) => /method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(call));

test("no component or page generates an idempotency key or sets the header by hand", () => {
  const inBrowser = (file: string) => /^(components|hooks|lib\/client)\//.test(file) || (file.startsWith("app/") && !file.startsWith("app/api/"));
  const offenders = files.filter((file) => inBrowser(file) && !OWNERS.has(file) && /randomUUID\(|["'`]idempotency-key["'`]|useAttemptKey|attempt-key/i.test(read(file)));
  assert.deepEqual(offenders, []);
  assert.equal(files.includes("lib/client/attempt-key.ts"), false, "the old per-form key hook is gone");
});

test("no component sends a POST, PUT, PATCH or DELETE with its own fetch, except the public sign-in pages", () => {
  const offenders = files.filter((file) => (file.startsWith("components/") || file.startsWith("app/") || file.startsWith("hooks/")) && !PUBLIC_PAGES.includes(file) && writes(file).length > 0);
  assert.deepEqual(offenders, []);
});

test("the public-page exception list only holds pages that still need it", () => {
  assert.deepEqual(
    PUBLIC_PAGES.filter((file) => writes(file).length === 0),
    [],
  );
});

test("the money and stock forms use the shared hook", () => {
  const required = [
    "components/sales/sale-form.tsx", // POS
    "components/returns/return-form.tsx", // sale and purchase returns
    "components/purchasing/purchase-form.tsx", // purchase, supplier payment
    "components/customers/forms.tsx", // customer forms
    "components/customers/party-search.tsx", // due collection and supplier payment search
    "components/shifts/forms.tsx", // shifts and cash handover
    "components/accounting/forms.tsx", // journals, vouchers, capital, loans
    "components/imports/forms.tsx", // product and opening-stock import
    "components/inventory/stock-forms.tsx", // stock in, adjustment, damage, expiry
    "components/inventory/transfer-form.tsx", // transfers
  ];
  const missing = required.filter((file) => !/use-submit|use-form-submit/.test(read(file)));
  assert.deepEqual(missing, []);
});

test("a form that uses the shared hook does not also reload or replace the page by hand after a write", () => {
  // The hook refreshes the page data in place or navigates with the router. (The POS "try again" button after a
  // failed load is not a write and is the one allowed reload.)
  const offenders = files.filter(
    (file) => file.startsWith("components/") && /use-submit|use-form-submit/.test(read(file)) && /window\.location\.(reload|replace|assign)\(/.test(read(file)) && file !== "components/sales/sale-form.tsx",
  );
  assert.deepEqual(offenders, []);
});
