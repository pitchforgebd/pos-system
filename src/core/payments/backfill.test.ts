import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { runTx } from "../tx/run.ts";
import { addDays, businessDate as today } from "../time/business-date.ts";
import { factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { assertBooksReconcile } from "../reconcile/index.ts";
import { createCustomer } from "../../modules/customers/customers.ts";
import { postCustomerPayment } from "../../modules/customers/dues.ts";
import { postPurchase, postSupplierPayment } from "../../modules/purchasing/purchases.ts";
import { postSale } from "../../modules/sales/sales.ts";
import { allocationViolations } from "./index.ts";
import { backfillAllocations } from "./backfill.ts";

// Receipts and payments made before P02 have no allocation rows, so every old invoice would read UNPAID. backfillAllocations
// replays them oldest first and writes the rows the new code would have written.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test" });

/** invoice or bill -> what has been allocated to it, from the allocation rows. */
async function settled(t: T) {
  const rows = await prisma.paymentAllocation.findMany({ where: { organizationId: t.org.id } });
  const sums = new Map<string, string>();
  for (const row of rows) {
    const id = row.invoiceId ?? row.billId ?? "";
    sums.set(id, (Number(sums.get(id) ?? 0) + Number(row.amount)).toFixed(2));
  }
  return Object.fromEntries([...sums].sort());
}

test("customers: replaying old receipts gives the same settlement as posting them today (opening first, oldest first)", async () => {
  await withTestOrg(async (t) => {
    await prisma.organization.update({ where: { id: t.org.id }, data: { backdateDays: 10 } });
    const product = await stockedProduct(t);
    const made = await createCustomer({ ...actor(t), actorId: t.owner.id, name: "Old customer", openingBalance: "60.00" });
    assert.equal(made.ok, true);
    const customerId = made.ok ? made.customer.id : "";
    const sale = await postSale({ ...actor(t), idempotencyKey: randomUUID(), businessDate: addDays(today(), -2), customerId, lines: [{ productId: product.id, quantity: "10" }] });
    assert.equal(sale.ok, true, JSON.stringify(sale));
    for (const [daysAgo, amount] of [[1, "80.00"], [0, "50.00"]] as const) {
      const paid = await postCustomerPayment({ ...actor(t), idempotencyKey: randomUUID(), customerId, businessDate: addDays(today(), -daysAgo), amount, method: "CASH" });
      assert.equal(paid.ok, true, JSON.stringify(paid));
    }
    const live = await settled(t);
    assert.deepEqual(Object.values(live), ["70.00"], "60 of the first receipt went to the opening, 20 and 50 to the invoice");

    await prisma.paymentAllocation.deleteMany({ where: { organizationId: t.org.id } }); // the database as the old code left it
    assert.deepEqual(await settled(t), {});
    const done = await runTx((tx) => backfillAllocations(tx, t.org.id));
    assert.equal(done, 2, "both receipts replayed");
    assert.deepEqual(await settled(t), live);
    assert.equal(await runTx((tx) => backfillAllocations(tx, t.org.id)), 0, "nothing left to do the second time");
    assert.deepEqual(await allocationViolations(prisma, t.org.id), []);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("vendors: a payment made together with a purchase is not replayed as a payment", async () => {
  await withTestOrg(async (t) => {
    await prisma.organization.update({ where: { id: t.org.id }, data: { backdateDays: 10 } });
    const product = await factories(t).product({ purchasePrice: "10.00" });
    const vendor = await factories(t).vendor();
    const buy = async (units: string, daysAgo: number, extra: Record<string, unknown> = {}) => {
      const bought = await postPurchase({ ...actor(t), idempotencyKey: randomUUID(), supplierId: vendor.id, businessDate: addDays(today(), -daysAgo), lines: [{ productId: product.id, quantity: units, unitCost: "10.00" }], ...extra } as Parameters<typeof postPurchase>[0]);
      assert.equal(bought.ok, true, JSON.stringify(bought));
    };
    await buy("10", 2); // 100
    await buy("5", 1, { paymentAmount: "20.00", paymentMethod: "CASH" }); // 50, 20 paid with it
    const paid = await postSupplierPayment({ ...actor(t), idempotencyKey: randomUUID(), supplierId: vendor.id, businessDate: today(), amount: "120.00", method: "CASH" });
    assert.equal(paid.ok, true, JSON.stringify(paid));
    const live = await settled(t);
    assert.deepEqual(Object.values(live).sort(), ["100.00", "20.00"]);

    await prisma.paymentAllocation.deleteMany({ where: { organizationId: t.org.id } });
    assert.equal(await runTx((tx) => backfillAllocations(tx, t.org.id)), 1, "only the standalone payment");
    assert.deepEqual(await settled(t), live);
    assert.deepEqual(await allocationViolations(prisma, t.org.id), []);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
