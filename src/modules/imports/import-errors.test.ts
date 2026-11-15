import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { POST as createBranch } from "../../app/api/v1/branches/route.ts";
import { POST as createCapital } from "../../app/api/v1/accounting/capitals/route.ts";
import { POST as importOpeningStock } from "../../app/api/v1/inventory/opening-stock/import/route.ts";
import { POST as importProducts } from "../../app/api/v1/products/import/route.ts";
import { POST as previewProducts } from "../../app/api/v1/products/import/preview/route.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { openSession } from "../auth/session.ts";

// P12 (L10, L11): a body field has a length limit, and an import that is given rubbish answers in the standard envelope, never with an exception.

async function signedIn(t: { org: { id: string }; owner: { id: string }; branch: { id: string } }) {
  const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
  return `meridian_session=${token}`;
}

const post = (cookie: string, path: string, body: unknown) =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1", cookie, "idempotency-key": randomUUID() },
    body: JSON.stringify(body),
  });
const context = { params: Promise.resolve({}) };

test("an import given rubbish answers in the standard envelope, without a stack or a query in it", async () => {
  await withTestOrg(async (t) => {
    const cookie = await signedIn(t);
    const rubbish = [
      "",
      "\u0000\u0000\u0000",
      "name,sku\n\"unterminated,quote\n",
      "a,b,c\n".repeat(2000),
      "﻿sku,name,purchasePrice\nX1,\"Seed\",not-a-number\n",
      `sku,name\n${"x".repeat(100_000)},y\n`,
      "';DROP TABLE products;--,1\n",
      "sku\n".repeat(3),
    ];
    for (const csv of rubbish) {
      for (const [label, route, path, extra] of [
        ["products import", importProducts, "/api/v1/products/import", {}],
        ["products preview", previewProducts, "/api/v1/products/import/preview", {}],
        ["opening stock import", importOpeningStock, "/api/v1/inventory/opening-stock/import", { businessDate: "2026-10-01" }],
      ] as const) {
        const response = await route(post(cookie, path, { csv, ...extra }), context);
        const text = await response.text();
        const body = JSON.parse(text) as { success?: boolean; error?: { code?: string } };
        assert.equal(typeof body.success, "boolean", `${label}: an envelope for ${JSON.stringify(csv.slice(0, 20))}`);
        if (body.success === false) {
          assert.ok(body.error?.code, `${label}: a code`);
        }
        assert.ok(response.status < 600);
        assert.equal(/\bat\s+\S+\s+\(|node_modules|SELECT |INSERT |prisma\./i.test(text), false, `${label}: no stack or query in the answer`);
      }
    }
  });
});

test("an oversize body field is refused (400) instead of reaching the database", async () => {
  await withTestOrg(async (t) => {
    const cookie = await signedIn(t);
    const branch = await createBranch(post(cookie, "/api/v1/branches", { name: "x".repeat(300) }), context);
    assert.equal(branch.status, 400);
    const capital = await createCapital(post(cookie, "/api/v1/accounting/capitals", { amount: "9".repeat(60), moneyAccountId: randomUUID(), businessDate: "2026-10-01" }), context);
    assert.equal(capital.status, 400);
    const csv = await importProducts(post(cookie, "/api/v1/products/import", { csv: "x".repeat(5_000_001) }), context);
    assert.equal(csv.status, 400);
  });
});
