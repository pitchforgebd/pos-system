import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Static guard. src/proxy.ts does not check sessions for /api, so each route handler must.
// A new route fails this test until it calls requireSession or is added to the public list on purpose.

const apiRoot = fileURLToPath(new URL("../../app/api", import.meta.url));

const publicRoutes = new Set([
  "health/route.ts",
  "v1/auth/login/route.ts",
  "v1/auth/logout/route.ts",
  "v1/auth/forgot-password/route.ts",
  "v1/auth/reset-password/route.ts",
]);

// Public routes that change state still need the same-origin check.
const publicRoutesWithoutOriginCheck = new Set(["health/route.ts"]);

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

test("every API route except the public list requires a session", () => {
  const missing = routeFiles().filter((route) => !publicRoutes.has(route) && !source(route).includes("requireSession("));
  assert.deepEqual(missing, []);
});

test("every API route that changes data rejects cross-site requests", () => {
  const missing = routeFiles().filter((route) => {
    if (publicRoutesWithoutOriginCheck.has(route)) {
      return false;
    }
    const text = source(route);
    const mutates = /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/.test(text);
    return mutates && !text.includes("rejectCrossSite(");
  });
  assert.deepEqual(missing, []);
});
