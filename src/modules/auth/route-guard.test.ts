import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Static guard (invariant I17). src/proxy.ts does not check sessions for /api, so every route handler must go
// through defineRoute (origin check, session, permission, transaction, error answers). A new route fails this
// test until it uses defineRoute; it can be public only if it is added to the list below on purpose.

const apiRoot = fileURLToPath(new URL("../../app/api", import.meta.url));

const publicRoutes = new Set([
  "health/route.ts",
  "v1/auth/login/route.ts",
  "v1/auth/logout/route.ts",
  "v1/auth/forgot-password/route.ts",
  "v1/auth/reset-password/route.ts",
]);

function routeFiles() {
  return readdirSync(apiRoot, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith("route.ts"))
    .map((entry) => entry.split(sep).join("/"))
    .sort();
}

function source(route: string) {
  return readFileSync(join(apiRoot, ...route.split("/")), "utf8");
}

test("the API route list is found", () => {
  const routes = routeFiles();
  assert.equal(routes.length > 50, true, `found ${routes.length} routes under ${relative(process.cwd(), apiRoot)}`);
  for (const route of publicRoutes) {
    assert.equal(routes.includes(route), true, `public route ${route} no longer exists; update the list`);
  }
});

test("every route handler is written with defineRoute, none as a plain function", () => {
  const plain = routeFiles().filter((route) => /^export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m.test(source(route)));
  assert.deepEqual(plain, []);
  const without = routeFiles().filter((route) => !/export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*defineRoute/.test(source(route)));
  assert.deepEqual(without, []);
});

test("every API route except the public list requires a session (no `public: true` elsewhere)", () => {
  const publicHere = routeFiles().filter((route) => /\bpublic:\s*true\b/.test(source(route)));
  assert.deepEqual(publicHere, [...publicRoutes].sort());
});

test("no route repeats the guards by hand: defineRoute does the origin check, the session and the permission", () => {
  const manual = routeFiles().filter((route) => /\b(rejectCrossSite|requireSession)\s*\(/.test(source(route)));
  assert.deepEqual(manual, []);
});

test("no route that changes data switches the origin check off", () => {
  const off = routeFiles().filter((route) => /\bcsrf:\s*false\b/.test(source(route)));
  assert.deepEqual(off, []);
});

// Routes without a permission line. A session is enough for the first two (any signed-in user may change their own
// language or branch); the others decide by the user's permissions inside the handler (any of several, or by method).
// The charge a bank or mobile account takes is only a proposal for a form (a cashier needs it at the register); it writes nothing.
const sessionOnly = new Set(["v1/locale/route.ts", "v1/session/branch/route.ts", "v1/money-accounts/charge/route.ts"]);
const checksInside = new Set(["v1/pos/barcode/route.ts", "v1/products/[id]/image/route.ts", "v1/users/[id]/route.ts"]);

test("every route except the public list names the permission it needs", () => {
  const missing = routeFiles()
    .filter((route) => !publicRoutes.has(route) && !sessionOnly.has(route) && !checksInside.has(route))
    .filter((route) => {
      const text = source(route);
      const handlers = text.match(/export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*defineRoute/g) ?? [];
      const permissions = text.match(/\bpermission:\s*(\[|")/g) ?? [];
      return permissions.length < handlers.length;
    });
  assert.deepEqual(missing, []);
});

test("a route that checks permissions itself really does", () => {
  const silent = [...checksInside].filter((route) => !/permissions\.has\(|requirePermission\(/.test(source(route)));
  assert.deepEqual(silent, []);
});
