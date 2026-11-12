import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { partyBalance } from "../../core/parties/index.ts";
import { invoicePayment } from "../../core/payments/index.ts";
import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { postCustomerAdvance } from "../customers/advances.ts";
import { createBankAccount } from "../accounting/books.ts";
import { setPrices } from "../pricing/index.ts";
import { concurrentlySettled, factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { postInvoice, type InvoiceInput } from "./invoice.ts";

// P06 task 2 (#17, #18, #20): every sale is an invoice on the customer's receivable (a cash sale is made to Walk-in); what is paid now is
// one receipt per payment, each settling the invoice; the customer is locked first (N5); the price comes from the level and the quantity.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T, key = randomUUID()) => ({ ...t.actor, idempotencyKey: key });
const sell = (t: T, input: Partial<InvoiceInput> & Pick<InvoiceInput, "lines">, key?: string) => postInvoice({ ...actor(t, key), businessDate: today(), ...input });
const owes = async (t: T, customerId: string) => (await partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customerId })).toFixed(2);

async function wallet(t: T, input: { type: "MOBILE" | "BANK"; name: string }) {
  const made = await createBankAccount({ ip: "127.0.0.1", userAgent: "test", organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, idempotencyKey: randomUUID(), name: input.name, kind: input.type, accountNumber: "01711-000000" });
  assert.equal(made.ok, true, JSON.stringify(made));
  return prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: input.name } });
}

test("cash + bKash + on credit in one sale: one invoice, a receipt for each payment, the charge is an expense, the invoice is PARTIAL", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 100, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const bkash = await wallet(t, { type: "MOBILE", name: "bKash" });
    const done = await sell(t, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: "10" }],
      tenders: [{ method: "CASH", amount: "40.00" }, { method: "MOBILE", accountId: bkash.id, amount: "30.00", charge: "0.55" }],
    });
    assert.equal(done.ok, true, JSON.stringify(done));
    if (!done.ok) {
      return;
    }
    assert.deepEqual([done.total, done.paid, done.due], ["100.00", "70.00", "30.00"]);
    const bill = await invoicePayment(prisma, t.org.id, done.id);
    assert.deepEqual([bill.status, bill.owed.toFixed(2), bill.allocated.toFixed(2)], ["PARTIAL", "30.00", "70.00"]);
    assert.equal(await owes(t, customer.id), "30.00");
    // the sale journal: the whole invoice on the receivable, sales, and the cost of goods
    const roles = async (docType: string) => (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType } }, include: { account: { include: { roles: true } } } })).map((l) => `${l.account.roles[0]?.role ?? l.account.code}:${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`).sort();
    assert.deepEqual(await roles("SALE"), ["AR:100.00/0.00", "COGS:60.00/0.00", "INVENTORY:0.00/60.00", "SALES:0.00/100.00"]);
    assert.deepEqual(await roles("CUSTOMER_PAYMENT"), ["AR:0.00/30.00", "AR:0.00/40.00", "CASH:40.00/0.00", "MOBILE_CHARGE:0.55/0.00", `${bkash.code}:29.45/0.00`].sort());
    const receipts = await prisma.customerPayment.findMany({ where: { organizationId: t.org.id }, orderBy: { amount: "asc" } });
    assert.deepEqual(receipts.map((r) => [r.method, r.amount.toFixed(2), r.charge.toFixed(2)]), [["MOBILE", "30.00", "0.55"], ["CASH", "40.00", "0.00"]]);
    assert.ok(receipts.every((r) => /^RCV-/.test(r.number ?? "")));
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { productId: product.id } })).quantity.toFixed(4), "90.0000");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a cash sale to nobody is made to Walk-in; an unpaid part needs a named customer", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const cash = await sell(t, { lines: [{ productId: product.id, quantity: "2" }], tenders: [{ method: "CASH", amount: "20.00" }] });
    assert.equal(cash.ok, true, JSON.stringify(cash));
    const walkIn = await prisma.customer.findFirstOrThrow({ where: { organizationId: t.org.id, isSystem: true } });
    assert.equal(walkIn.name, "Walk-in");
    assert.equal((await invoicePayment(prisma, t.org.id, cash.ok ? cash.id : "")).status, "PAID");
    const unpaid = await sell(t, { lines: [{ productId: product.id, quantity: "1" }], tenders: [{ method: "CASH", amount: "4.00" }] });
    assert.equal(unpaid.ok, false);
    assert.match(!unpaid.ok ? unpaid.message : "", /customer/i);
    assert.equal(await prisma.customer.count({ where: { organizationId: t.org.id, isSystem: true } }), 1, "one Walk-in");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("two sales that spend the same wallet at once: one succeeds (N5)", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 50, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const advance = await postCustomerAdvance({ ...actor(t), customerId: customer.id, businessDate: today(), amount: "100.00", method: "CASH" });
    assert.equal(advance.ok, true);
    const results = await concurrentlySettled(2, () => sell(t, { customerId: customer.id, lines: [{ productId: product.id, quantity: "8" }], tenders: [{ method: "WALLET", amount: "80.00" }] }));
    const outcomes = results.map((r) => (r.status === "fulfilled" ? r.value.ok : false));
    assert.equal(outcomes.filter(Boolean).length, 1, JSON.stringify(results.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason)))));
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id, account: "ADVANCE" })).toFixed(2), "20.00");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("two credit sales at once cannot push the customer over the credit limit (N5)", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 50, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer({ creditLimit: "100.00" });
    const results = await concurrentlySettled(3, () => sell(t, { customerId: customer.id, lines: [{ productId: product.id, quantity: "6" }] }));
    const ok = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    assert.equal(ok, 1, "60 + 60 would be over 100");
    assert.equal(await owes(t, customer.id), "60.00");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the price comes from the level and the quantity; the customer type sets the level; changing the level needs permission", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 100, cost: "50.00", price: "100.00", product: { minimumPrice: "70.00", wholesalePrice: "90.00" } });
    const { runTx } = await import("../../core/tx/run.ts");
    await runTx((tx) => setPrices(tx, { organizationId: t.org.id, productId: product.id, prices: [{ level: "Retail", minQty: "1", price: "100.00" }, { level: "Wholesale", minQty: "1", price: "90.00" }, { level: "Wholesale", minQty: "10", price: "80.00" }] }));
    const levels = await prisma.priceLevel.findMany({ where: { organizationId: t.org.id } });
    const wholesale = levels.find((l) => l.name === "Wholesale");
    const type = await prisma.customerType.create({ data: { organizationId: t.org.id, name: "Shop", priceLevelId: wholesale?.id } });
    const shop = await factories(t).customer({ customerTypeId: type.id });
    const retail = await factories(t).customer();
    const unit = async (customerId: string, quantity: string, extra: Partial<InvoiceInput> = {}) => {
      const done = await sell(t, { customerId, lines: [{ productId: product.id, quantity }], tenders: [], ...extra });
      assert.equal(done.ok, true, JSON.stringify(done));
      return done.ok ? (await prisma.saleItem.findFirstOrThrow({ where: { saleId: done.id } })).unitPrice.toFixed(2) : "";
    };
    assert.equal(await unit(retail.id, "1"), "100.00", "retail customer, retail price");
    assert.equal(await unit(shop.id, "1"), "90.00", "the shop's type buys at Wholesale");
    assert.equal(await unit(shop.id, "10"), "80.00", "10 or more: the step price");
    const refused = await sell(t, { customerId: retail.id, level: "Wholesale", allowPriceLevel: false, lines: [{ productId: product.id, quantity: "1" }] });
    assert.equal(refused.ok, false);
    assert.equal(await unit(retail.id, "1", { level: "Wholesale", allowPriceLevel: true }), "90.00", "with the permission, the cashier may choose the level");
    const below = await sell(t, { customerId: retail.id, allowPriceOverride: true, lines: [{ productId: product.id, quantity: "1", unitPrice: "60.00" }] });
    assert.equal(below.ok, false, "never below the minimum price");
    const lines = await prisma.saleItem.findMany({ where: { organizationId: t.org.id } });
    assert.ok(lines.every((l) => l.unitCost?.toFixed(4) === "50.0000"), "each line keeps what a unit cost when it was sold");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a discount: by percent, over the invoice shared to the lines so the VAT is on what is charged, never above the maximum", async () => {
  await withTestOrg(async (t) => {
    const a = await stockedProduct(t, { units: 20, cost: "6.00", price: "100.00", product: { vatType: "EXCLUSIVE", vatValue: "10" } });
    const b = await stockedProduct(t, { units: 20, cost: "6.00", price: "100.00", product: { vatType: "EXCLUSIVE", vatValue: "10" } });
    const customer = await factories(t).customer();
    const done = await sell(t, { customerId: customer.id, headerDiscount: "20.00", lines: [{ productId: a.id, quantity: "1", discountPercent: "10" }, { productId: b.id, quantity: "1" }], tenders: [{ method: "CASH", amount: "1.00" }] });
    assert.equal(done.ok, true, JSON.stringify(done));
    // a: 100 less 10% = 90; b: 100; the header 20 shared by value (90 : 100) = 9.47 : 10.53 -> 80.53 and 89.47; VAT 10% = 8.05 + 8.95 = 17.00
    const sale = await prisma.sale.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.deepEqual([sale.subtotal.toFixed(2), sale.discountTotal.toFixed(2), sale.vatTotal.toFixed(2), sale.total.toFixed(2)], ["200.00", "30.00", "17.00", "187.00"]);
    await prisma.organization.update({ where: { id: t.org.id }, data: { maxDiscountPercent: "15" } });
    const over = await sell(t, { customerId: customer.id, lines: [{ productId: a.id, quantity: "1", discountPercent: "16" }] });
    assert.equal(over.ok, false);
    assert.match(!over.ok ? over.message : "", /15/);
    const noPermission = await sell(t, { customerId: customer.id, allowDiscount: false, lines: [{ productId: a.id, quantity: "1", discountAmount: "1.00" }] });
    assert.equal(noPermission.ok, false);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("taking the previous due with the sale (D22): what is paid beyond the invoice settles the oldest invoice first", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 50, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const old = await sell(t, { customerId: customer.id, businessDate: "2026-10-01", lines: [{ productId: product.id, quantity: "5" }] });
    assert.ok(old.ok);
    const tooMuch = await sell(t, { customerId: customer.id, lines: [{ productId: product.id, quantity: "2" }], tenders: [{ method: "CASH", amount: "20.01" }] });
    assert.equal(tooMuch.ok, false, "without the option, more than the invoice is refused");
    const fresh = await sell(t, { customerId: customer.id, takePreviousDue: true, lines: [{ productId: product.id, quantity: "2" }], tenders: [{ method: "CASH", amount: "70.00" }] });
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.equal((await invoicePayment(prisma, t.org.id, old.ok ? old.id : "")).status, "PAID");
    assert.equal((await invoicePayment(prisma, t.org.id, fresh.ok ? fresh.id : "")).status, "PAID");
    assert.equal(await owes(t, customer.id), "0.00");
    const beyond = await sell(t, { customerId: customer.id, takePreviousDue: true, lines: [{ productId: product.id, quantity: "1" }], tenders: [{ method: "CASH", amount: "10.01" }] });
    assert.equal(beyond.ok, false, "never more than what is owed");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the same request twice (a network retry): one invoice, one receipt, one stock movement", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const key = randomUUID();
    const input = { lines: [{ productId: product.id, quantity: "3" }], tenders: [{ method: "CASH" as const, amount: "30.00" }] };
    const first = await sell(t, input, key);
    const again = await sell(t, input, key);
    assert.deepEqual([first.ok, again.ok, again.ok && again.replayed, again.ok && first.ok && again.id === first.id], [true, true, true, true]);
    assert.deepEqual([await prisma.sale.count({ where: { organizationId: t.org.id } }), await prisma.customerPayment.count({ where: { organizationId: t.org.id } }), await prisma.stockLedger.count({ where: { organizationId: t.org.id, movementType: "SALE" } })], [1, 1, 1]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
