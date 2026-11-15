import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { buildAgriDay, EXPECTED } from "../../tests/golden/agri-day.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import type { ReportCtx, ReportResult } from "./kit.ts";
import { DAILY } from "./registry.ts";

// P11 (06 §4): the golden day. Each of the ten daily reports is run over it and compared with the figures worked out by hand (tests/golden), and
// every identity under every report must be green.

const summary = (report: ReportResult, label: string) => report.summary.find((row) => row.label.en === label)?.value;
const section = (report: ReportResult, key: string) => report.sections.find((row) => row.key === key);
const rowOf = (report: ReportResult, key: string, column: string, match: string) => section(report, key)?.rows.find((row) => String(row[column]).startsWith(match));

test("the golden day: every daily report gives the figures worked out by hand, and every identity is green", async () => {
  await withTestOrg(async (t) => {
    const { day, ids } = await buildAgriDay(t);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
    const ctx: ReportCtx = { organizationId: t.org.id, branchIds: [t.branch.id], from: day, to: day, canProfit: true };
    const run = async (key: string) => {
      const report = DAILY.find((row) => row.key === key);
      assert.ok(report, key);
      const result = await report.run(ctx);
      for (const check of result.identities) {
        assert.ok(check.ok, `${key}: ${check.label.en}: ${check.left} vs ${check.right} (difference ${check.difference})`);
      }
      return result;
    };

    // 10. cash
    const cash = await run("cash");
    const branch = section(cash, "branches")?.rows[0];
    const c = EXPECTED.cash;
    assert.deepEqual([branch?.opening, branch?.sales, branch?.dues, branch?.expenses, branch?.payments, branch?.toBank, branch?.closing], [c.opening, c.sales, c.dues, c.expenses, c.payments, c.toBank, c.closing], "cash");

    // 9. bank and mobile
    const bank = await run("bank");
    const b = EXPECTED.bank;
    assert.deepEqual([summary(bank, "Opening"), summary(bank, "In"), summary(bank, "Out"), summary(bank, "Closing")], [b.opening, b.in, b.out, b.closing], "bank totals");
    const bkash = rowOf(bank, "accounts", "account", "bKash");
    assert.deepEqual([bkash?.charge, bkash?.closing], [b.bkashCharge, b.bkashClosing], "bKash");
    assert.equal(rowOf(bank, "accounts", "account", "Bank (default)")?.closing, b.bankClosing);

    // 6. money in, 5. money out
    const receive = await run("receive");
    assert.deepEqual([summary(receive, "Total"), summary(receive, "Of it, transfers between own accounts"), summary(receive, "Without the transfers")], [EXPECTED.receive.total, EXPECTED.receive.transfers, EXPECTED.receive.withoutTransfers], "receive");
    const payment = await run("payment");
    assert.deepEqual([summary(payment, "Total"), summary(payment, "Of it, transfers between own accounts"), summary(payment, "Without the transfers")], [EXPECTED.payment.total, EXPECTED.payment.transfers, EXPECTED.payment.withoutTransfers], "payment");

    // 1. sales
    const sales = await run("sales");
    const s = EXPECTED.sales;
    assert.deepEqual([summary(sales, "Invoices"), summary(sales, "Sales"), summary(sales, "Returns"), summary(sales, "Net sales"), summary(sales, "Gross profit on these invoices")], [s.invoices, s.sales, s.returns, s.net, s.gross], "sales summary");
    const methods = Object.fromEntries((section(sales, "methods")?.rows ?? []).map((row) => [row.method, row.amount]));
    assert.deepEqual([methods.CASH, methods.MOBILE], [s.cash, s.mobile], "by method");
    const creditRow = section(sales, "invoices")?.rows.find((row) => row.total === "3600.00");
    assert.deepEqual([creditRow?.owed, creditRow?.status], [s.creditOwed, s.creditStatus], "the credit sale after the return and the payment");

    // 3. dues
    const due = await run("due");
    const k = EXPECTED.due.karim;
    const karim = rowOf(due, "customers", "name", "Karim");
    assert.deepEqual([karim?.opening, karim?.added, karim?.paid, karim?.returned, karim?.other, karim?.closing], [k.opening, k.added, k.paid, k.returned, k.other, k.closing], "Karim");
    assert.deepEqual([summary(due, "Customers owe"), summary(due, "The shop owes vendors")], [EXPECTED.due.customersOwe, EXPECTED.due.vendorOwed]);
    const mill = rowOf(due, "vendors", "name", "Agro Mill");
    assert.deepEqual([mill?.added, mill?.paid, mill?.closing], [EXPECTED.due.vendor.added, EXPECTED.due.vendor.paid, EXPECTED.due.vendor.closing], "Agro Mill");

    // 4. condition
    const condition = await run("condition");
    const steadfast = rowOf(condition, "couriers", "courier", "Steadfast");
    assert.deepEqual([steadfast?.handed, steadfast?.delivery, steadfast?.condition, steadfast?.closing], [EXPECTED.condition.handed, EXPECTED.condition.delivery, EXPECTED.condition.condition, EXPECTED.condition.closing], "Steadfast");

    // 8. expenses
    const expenses = await run("expenses");
    assert.equal(summary(expenses, "Total"), EXPECTED.expenses.total, "expenses");

    // 2. stock
    const stock = await run("stock");
    const u = EXPECTED.stock.urea;
    const urea = rowOf(stock, "products", "product", "Urea bag");
    assert.deepEqual([urea?.opening, urea?.purchased, urea?.sold, urea?.returnedIn, urea?.closing, urea?.value], [u.opening, u.purchased, u.sold, u.returnedIn, u.closing, u.value], "urea");
    const p = EXPECTED.stock.pesticide;
    const pesticide = rowOf(stock, "products", "product", "Pesticide");
    assert.deepEqual([pesticide?.sold, pesticide?.damaged, pesticide?.closing, pesticide?.value], [p.sold, p.damaged, p.closing, p.value], "pesticide");
    const sd = EXPECTED.stock.seed;
    const seed = rowOf(stock, "products", "product", "Seed packet");
    assert.deepEqual([seed?.sold, seed?.takenOff, seed?.closing, seed?.value], [sd.sold, sd.takenOff, sd.closing, sd.value], "seed");
    assert.equal(summary(stock, "Stock value at cost"), EXPECTED.stock.value);

    // 7. profit and loss
    const profit = await run("profit");
    assert.deepEqual([summary(profit, "Gross profit"), summary(profit, "Net profit")], [EXPECTED.profit.gross, EXPECTED.profit.net], "profit");
    void ids;
  });
});

test("cost and profit stay hidden without reports.profit", async () => {
  await withTestOrg(async (t) => {
    const { day } = await buildAgriDay(t);
    const ctx: ReportCtx = { organizationId: t.org.id, branchIds: [t.branch.id], from: day, to: day, canProfit: false };
    const sales = await DAILY.find((row) => row.key === "sales")?.run(ctx);
    assert.ok(sales && !sales.sections[0].columns.some((column) => column.key === "cogs" || column.key === "profit"));
    assert.ok(sales && !sales.summary.some((row) => row.label.en.includes("profit")));
    const stock = await DAILY.find((row) => row.key === "stock")?.run(ctx);
    assert.ok(stock && !stock.sections[0].columns.some((column) => column.key === "value"));
  });
});

test("a sale at half past midnight in Dhaka belongs to that Dhaka day", () => {
  // 00:30 on 15 November in Dhaka is 18:30 on 14 November in UTC
  assert.equal(businessDate(new Date("2026-11-14T18:30:00.000Z")), "2026-11-15");
  assert.equal(businessDate(new Date("2026-11-14T17:59:00.000Z")), "2026-11-14");
});
