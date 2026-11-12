import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { partyBalance } from "../../core/parties/index.ts";
import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { concurrentlySettled, factories, withTestOrg } from "../../tests/helpers/index.ts";
import { postSale } from "../sales/sales.ts";
import { postSaleReturn } from "../sales/returns.ts";
import { postCustomerAdvance } from "./advances.ts";
import { postCustomerPayment } from "./dues.ts";

// P02 task 7 (N16): a customer's advance is money the shop holds for them, a liability of its own (Customer Advance), not a
// negative receivable. Their wallet is the balance of that account for them; buying from the wallet lowers it and
// leaves the receivable alone.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

async function shopWithStock(t: T, price = "10.00") {
  const product = await factories(t).product({ sellingPrice: price, purchasePrice: "6.00", wholesalePrice: price, minimumPrice: "1.00" });
  await prisma.stockBalance.create({ data: { organizationId: t.org.id, productId: product.id, branchId: t.branch.id, warehouseId: t.warehouse.id, quantity: "500.0000" } });
  await prisma.stockLedger.create({
    data: { organizationId: t.org.id, productId: product.id, branchId: t.branch.id, warehouseId: t.warehouse.id, quantity: "500.0000", direction: "IN", movementType: "OPENING", referenceType: "test", referenceId: product.id, unitCost: "6.00", userId: t.owner.id },
  });
  return product;
}

const actor = (t: T) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test" });
const wallet = (t: T, customerId: string) => partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customerId, account: "ADVANCE" }).then((v) => v.toFixed(2));
const owes = (t: T, customerId: string) => partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customerId }).then((v) => v.toFixed(2));

async function advance(t: T, customerId: string, amount: string) {
  const result = await postCustomerAdvance({ ...actor(t), idempotencyKey: randomUUID(), customerId, businessDate: today(), amount, method: "CASH" });
  assert.equal(result.ok, true, JSON.stringify(result));
}

function sale(t: T, productId: string, quantity: string, extra: Record<string, unknown> = {}) {
  return postSale({ ...actor(t), idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId, quantity }], ...extra } as Parameters<typeof postSale>[0]);
}

test("an advance goes to the Customer Advance account with the customer on the line, and the receivable stays zero", async () => {
  await withTestOrg(async (t) => {
    const customer = await factories(t).customer();
    await advance(t, customer.id, "100.00");
    assert.equal(await wallet(t, customer.id), "100.00");
    assert.equal(await owes(t, customer.id), "0.00", "an advance is not a negative receivable");
    const line = await prisma.journalLine.findFirstOrThrow({ where: { organizationId: t.org.id, credit: { gt: 0 }, journal: { docType: "CUSTOMER_ADVANCE" } }, include: { account: { include: { roles: true } } } });
    assert.deepEqual(line.account.roles.map((r) => r.role), ["CUSTOMER_ADVANCE"]);
    assert.equal(line.partyId, customer.id);
    await assertBooksReconcile(t.org.id);
  });
});

test("buying from the wallet lowers the advance and leaves the receivable at zero: the wallet settles the invoice by a receipt (Dr Customer Advance / Cr Receivable)", async () => {
  await withTestOrg(async (t) => {
    const product = await shopWithStock(t);
    const customer = await factories(t).customer();
    await advance(t, customer.id, "100.00");
    const bought = await sale(t, product.id, "6", { customerId: customer.id, paymentAmount: "60.00", paymentMethod: "WALLET" });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    assert.equal(await wallet(t, customer.id), "40.00");
    assert.equal(await owes(t, customer.id), "0.00");
    const receipt = await prisma.journal.findFirstOrThrow({ where: { organizationId: t.org.id, docType: "CUSTOMER_PAYMENT" }, include: { lines: { include: { account: { include: { roles: true } } } } } });
    const roles = receipt.lines.map((l) => l.account.roles[0]?.role).sort();
    assert.deepEqual(roles, ["AR", "CUSTOMER_ADVANCE"], "the wallet pays the invoice through the receivable");
    await assertBooksReconcile(t.org.id);
  });
});

test("a sale that is part wallet and part credit lowers the wallet and raises the receivable by the rest", async () => {
  await withTestOrg(async (t) => {
    const product = await shopWithStock(t);
    const customer = await factories(t).customer();
    await advance(t, customer.id, "30.00");
    const bought = await sale(t, product.id, "5", { customerId: customer.id, paymentAmount: "30.00", paymentMethod: "WALLET" });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    assert.equal(await wallet(t, customer.id), "0.00");
    assert.equal(await owes(t, customer.id), "20.00");
  });
});

test("a wallet payment larger than the wallet is refused and nothing is posted", async () => {
  await withTestOrg(async (t) => {
    const product = await shopWithStock(t);
    const customer = await factories(t).customer();
    await advance(t, customer.id, "20.00");
    const before = await prisma.journal.count({ where: { organizationId: t.org.id } });
    const refused = await sale(t, product.id, "5", { customerId: customer.id, paymentAmount: "50.00", paymentMethod: "WALLET" });
    assert.equal(refused.ok, false);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), before);
    assert.equal(await wallet(t, customer.id), "20.00");
  });
});

test("a customer with a debt and an advance can pay the whole debt: the advance is not netted against it", async () => {
  await withTestOrg(async (t) => {
    const product = await shopWithStock(t);
    const customer = await factories(t).customer();
    const credit = await sale(t, product.id, "10", { customerId: customer.id }); // 100.00 on credit
    assert.equal(credit.ok, true, JSON.stringify(credit));
    await advance(t, customer.id, "40.00");
    assert.equal(await owes(t, customer.id), "100.00");
    assert.equal(await wallet(t, customer.id), "40.00");
    const paid = await postCustomerPayment({ ...actor(t), idempotencyKey: randomUUID(), customerId: customer.id, businessDate: today(), amount: "100.00", method: "CASH" });
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.equal(await owes(t, customer.id), "0.00");
    assert.equal(await wallet(t, customer.id), "40.00", "the advance is still there");
    await assertBooksReconcile(t.org.id);
  });
});

test("a return on a credit sale reduces what the customer owes, not their advance", async () => {
  await withTestOrg(async (t) => {
    const product = await shopWithStock(t);
    const customer = await factories(t).customer();
    const credit = await sale(t, product.id, "10", { customerId: customer.id });
    assert.equal(credit.ok, true, JSON.stringify(credit));
    await advance(t, customer.id, "25.00");
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: credit.ok ? credit.id : "" } });
    const returned = await postSaleReturn({ ...actor(t), idempotencyKey: randomUUID(), saleId: credit.ok ? credit.id : "", businessDate: today(), lines: [{ saleItemId: item.id, quantity: "4" }] });
    assert.equal(returned.ok, true, JSON.stringify(returned));
    assert.equal(await owes(t, customer.id), "60.00");
    assert.equal(await wallet(t, customer.id), "25.00");
  });
});

test("five parallel wallet purchases of 30 against a wallet of 100: exactly three go through and the wallet never goes below zero", async () => {
  await withTestOrg(async (t) => {
    const product = await shopWithStock(t);
    const customer = await factories(t).customer();
    await advance(t, customer.id, "100.00");
    const results = await concurrentlySettled(5, () => sale(t, product.id, "3", { customerId: customer.id, paymentAmount: "30.00", paymentMethod: "WALLET" }));
    const answers = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    assert.ok(answers.every((a) => a !== null), "no request crashed");
    assert.equal(answers.filter((a) => a?.ok).length, 3);
    assert.equal(await wallet(t, customer.id), "10.00");
    assert.equal(await owes(t, customer.id), "0.00");
  });
});
