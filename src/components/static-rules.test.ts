import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A component without "use client" can be rendered by a server page. A server page may not hand an event handler to the
// browser: Next answers "Event handlers cannot be passed to Client Component props" and the part of the page that holds
// the handler fails. A component that makes a handler of its own (onClick={() => ...}) must therefore be a client component.
// (A handler that arrives through props is fine: only a client component can pass one in.) Unit tests cannot see this, a
// built page can: it was found on /sales, where the pager made a handler for its disabled "Previous" button.

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const files = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
  .filter((entry) => /\.tsx$/.test(entry))
  .map((entry) => entry.split(sep).join("/"))
  .filter((file) => file.startsWith("components/") || file.startsWith("app/"))
  .sort();

// Reached only when the caller passes onSort, which only a client component can do.
const ALLOWED = new Set(["components/ui/data-table.tsx"]);

const inlineHandler = /\bon(Click|Change|Submit|Select|KeyDown|KeyUp|Blur|Focus|Input|Toggle)=\{\s*(\([^)]*\)|\w+)\s*=>/;

test("a component that creates its own event handler is a client component", () => {
  const offenders = files.filter((file) => {
    if (ALLOWED.has(file)) {
      return false;
    }
    const text = readFileSync(join(srcRoot, file), "utf8");
    const isClient = /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(text);
    return !isClient && inlineHandler.test(text);
  });
  assert.deepEqual(offenders, []);
});
