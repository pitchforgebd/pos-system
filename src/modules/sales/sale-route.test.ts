import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { POST } from "../../app/api/v1/sales/route.ts";
import { prisma } from "../../lib/db/client.ts";
import { businessDate } from "../../core/time/business-date.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { openSession } from "../auth/session.ts";

type Body = { success: boolean; data?: { id: string; number: string; replayed: boolean; total: string }; error?: { code: string; message: string } };

// The real sales route, the real postSale, the real database. This is the path a cashier's browser takes when it
// retries a sale (a double tap, a flaky network): ten requests with one key must make one sale with one number.
test("ten parallel POST /api/v1/sales with one key make one sale and every answer carries its number", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ sellingPrice: "35.00", purchasePrice: "20.00" });
    await prisma.stockBalance.create({
      data: { organizationId: t.org.id, productId: product.id, branchId: t.branch.id, warehouseId: t.warehouse.id, quantity: "50.0000" },
    });
    await prisma.stockLedger.create({
      data: {
        organizationId: t.org.id, productId: product.id, branchId: t.branch.id, warehouseId: t.warehouse.id,
        quantity: "50.0000", direction: "IN", movementType: "OPENING", referenceType: "test", referenceId: product.id,
        unitCost: "20.00", userId: t.owner.id,
      },
    });
    const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });

    const send = async (key: string, quantity: string) => {
      const response = await POST(
        new Request("http://localhost/api/v1/sales", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", cookie: `meridian_session=${token}`, "idempotency-key": key },
          body: JSON.stringify({
            businessDate: businessDate(),
            lines: [{ productId: product.id, quantity }],
            paymentAmount: (35 * Number(quantity)).toFixed(2),
            paymentMethod: "CASH",
          }),
        }),
        { params: Promise.resolve({}) },
      );
      return { status: response.status, body: (await response.json()) as Body };
    };

    const key = randomUUID();
    const answers = await Promise.all(Array.from({ length: 10 }, () => send(key, "1")));
    assert.deepEqual(
      answers.filter((answer) => answer.status !== 200 && answer.status !== 201).map((answer) => `${answer.status} ${answer.body.error?.message}`),
      [],
      "no request may fail with 409 or 500",
    );
    assert.equal(answers.filter((answer) => answer.status === 201).length, 1, "exactly one request made the sale");
    const numbers = new Set(answers.map((answer) => answer.body.data?.number));
    assert.equal(numbers.size, 1);
    assert.ok([...numbers][0]?.startsWith("INV-"));
    assert.equal(new Set(answers.map((answer) => answer.body.data?.total)).size, 1);
    assert.equal(await prisma.sale.count({ where: { organizationId: t.org.id } }), 1);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { productId: product.id } })).quantity.toFixed(4), "49.0000");
    assert.equal(await prisma.auditLog.count({ where: { organizationId: t.org.id, entityType: "sale" } }), 1, "one audit row for one sale");

    // Different keys in parallel: every one is its own sale and every sale gets its own number.
    const many = await Promise.all(Array.from({ length: 6 }, () => send(randomUUID(), "1")));
    assert.deepEqual(many.map((answer) => answer.status), [201, 201, 201, 201, 201, 201]);
    assert.equal(new Set(many.map((answer) => answer.body.data?.number)).size, 6);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { productId: product.id } })).quantity.toFixed(4), "43.0000");
  });
});
