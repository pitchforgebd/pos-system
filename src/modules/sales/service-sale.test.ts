import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { postSale } from "./sales.ts";

// P04 task 8 (N8): a service or other non-stock item (a delivery charge, transport) is sold with no stock movement and no cost of goods.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const who = (t: T) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, warehouseId: t.warehouse.id, ip: "127.0.0.1", userAgent: "test" });

const service = (t: T, extra: Record<string, unknown> = {}) =>
  factories(t).product({ name: "Delivery charge", sku: "SVC-1", slug: "svc-1", isService: true, trackStock: false, sellingPrice: "50.00", purchasePrice: "0.00", wholesalePrice: "50.00", minimumPrice: "10.00", ...extra } as never);

test("a service sells with no stock row, no stock movement, and no cost of goods", async () => {
  await withTestOrg(async (t) => {
    const delivery = await service(t);
    const sold = await postSale({ ...who(t), idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId: delivery.id, quantity: "2" }], paymentAmount: "100.00", paymentMethod: "CASH" });
    assert.equal(sold.ok, true, JSON.stringify(sold));
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: t.org.id } }), 0);
    assert.equal(await prisma.stockBalance.count({ where: { organizationId: t.org.id } }), 0);
    const lines = await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "SALE" } }, include: { account: { include: { roles: true } } } });
    assert.deepEqual(lines.map((l) => l.account.roles[0]?.role).sort(), ["AR", "SALES"], "receivable and sales: no COGS, no inventory");
    const receipt = await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "CUSTOMER_PAYMENT" } }, include: { account: { include: { roles: true } } } });
    assert.deepEqual(receipt.map((l) => l.account.roles[0]?.role).sort(), ["AR", "CASH"], "the cash comes in by the receipt");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a service sold with goods: only the goods move stock and carry a cost", async () => {
  await withTestOrg(async (t) => {
    const goods = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const delivery = await service(t);
    const sold = await postSale({ ...who(t), idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId: goods.id, quantity: "3" }, { productId: delivery.id, quantity: "1" }], paymentAmount: "80.00", paymentMethod: "CASH" });
    assert.equal(sold.ok, true, JSON.stringify(sold));
    const moves = await prisma.stockLedger.findMany({ where: { organizationId: t.org.id, movementType: "SALE" } });
    assert.deepEqual(moves.map((m) => [m.productId, m.quantity.toFixed(4), m.totalCost?.toFixed(2)]), [[goods.id, "3.0000", "18.00"]]);
    const cogs = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, account: { roles: { some: { role: "COGS" } } } }, _sum: { debit: true } });
    assert.equal(Number(cogs._sum.debit), 18);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a service on credit is a receivable like any sale", async () => {
  await withTestOrg(async (t) => {
    const delivery = await service(t);
    const customer = await factories(t).customer();
    const sold = await postSale({ ...who(t), idempotencyKey: randomUUID(), businessDate: today(), customerId: customer.id, lines: [{ productId: delivery.id, quantity: "1" }] });
    assert.equal(sold.ok, true, JSON.stringify(sold));
    const ar = await prisma.journalLine.findFirstOrThrow({ where: { organizationId: t.org.id, account: { roles: { some: { role: "AR" } } } } });
    assert.deepEqual([Number(ar.debit), ar.partyId], [50, customer.id]);
  });
});
