import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { addDays } from "../../core/time/business-date.ts";
import { buildAgriDay, EXPECTED } from "../../tests/golden/agri-day.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { dashboardFor, forgetDashboards, salesByDay } from "./dashboard.ts";
import { findReport } from "./registry.ts";
import type { ReportCtx } from "./kit.ts";

// P11 task 7 (I16, LV-1): a dashboard card is a figure its report publishes, so the two cannot differ; the week chart agrees with the sales report;
// the answer is kept for 30 seconds.

test("every card equals its report's figure, the golden day's hand figures show on the cards, the week chart agrees with the sales report", async () => {
  await withTestOrg(async (t) => {
    const { day } = await buildAgriDay(t);
    forgetDashboards();
    const base = { organizationId: t.org.id, branchIds: [t.branch.id], canProfit: true };
    const board = await dashboardFor(base, day);
    const ctx: ReportCtx = { ...base, from: day, to: day };
    const card = (key: string) => board.cards.find((row) => row.key === key)?.value;
    const figure = async (report: string, name: string) => (await findReport(report)?.run(ctx))?.figures?.[name];

    assert.equal(card("sales"), await figure("sales", "sales"));
    assert.equal(card("cash"), await figure("cash", "closing"));
    assert.equal(card("bank"), await figure("bank", "closing"));
    assert.equal(card("expenses"), await figure("expenses", "total"));
    assert.equal(card("profit"), await figure("profit", "net"));
    assert.equal(card("courier"), await figure("condition", "owed"));
    assert.equal(card("customersOwe"), await figure("due", "customersOwe"));
    assert.equal(card("vendorsOwed"), await figure("due", "vendorsOwed"));
    assert.equal(card("paidOut"), await figure("payment", "total"));

    // and they are the figures worked out by hand
    assert.deepEqual([card("sales"), card("cash"), card("bank"), card("expenses"), card("profit"), card("courier"), card("customersOwe"), card("vendorsOwed")], [EXPECTED.sales.sales, EXPECTED.cash.closing, EXPECTED.bank.closing, EXPECTED.expenses.total, EXPECTED.profit.net, EXPECTED.condition.closing, EXPECTED.due.customersOwe, EXPECTED.due.vendorOwed]);
    assert.equal(card("dueCollected"), "1000.00", "Karim's 1,000: receipts less what was paid at the sales");
    assert.equal(board.mismatches, 0);

    assert.equal(board.week.length, 7);
    const today = board.week.at(-1);
    assert.deepEqual([today?.date, today?.sales], [day, EXPECTED.sales.sales]);
    assert.ok(board.week.slice(0, 6).every((row) => row.sales === "0.00"));
    assert.equal((await salesByDay(base, day, 1))[0].sales, EXPECTED.sales.sales);
    assert.deepEqual(board.orders, [{ status: "DISPATCHED", count: 1 }], "the courier order is out");
    assert.equal(board.week[0].date, addDays(day, -6));
  });
});

test("a user without reports.profit gets no profit card; the answer is kept for 30 seconds", async () => {
  await withTestOrg(async (t) => {
    const { day } = await buildAgriDay(t);
    forgetDashboards();
    const base = { organizationId: t.org.id, branchIds: [t.branch.id], canProfit: false };
    const first = await dashboardFor(base, day);
    assert.ok(!first.cards.some((row) => row.key === "profit"));
    assert.equal(await dashboardFor(base, day), first, "the same answer within 30 seconds (one query run)");
    forgetDashboards();
    assert.notEqual(await dashboardFor(base, day), first);
  });
});
