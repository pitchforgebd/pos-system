import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { addDays, businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { createBankAccount } from "../accounting/books.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { generateDrafts, listCategories, saveRecurring } from "./expenses.ts";

// P08: the treasury routes. Every write takes an Idempotency-Key; the month-end accrual and the settings need their own permissions.

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

async function caller(t: T) {
  const { openSession } = await import("../auth/session.ts");
  const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
  return async (route: Handler, path: string, init: { method?: string; body?: unknown; key?: string | null; params?: Record<string, string> } = {}) => {
    const method = init.method ?? "POST";
    const headers: Record<string, string> = { origin: "http://localhost", cookie: `meridian_session=${token}`, "content-type": "application/json" };
    if (method !== "GET" && init.key !== null) {
      headers["idempotency-key"] = init.key ?? randomUUID();
    }
    const response = await route(new Request(`http://localhost${path}`, { method, headers, body: method === "GET" || init.body === undefined ? undefined : JSON.stringify(init.body) }), { params: Promise.resolve(init.params ?? {}) });
    return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown> & unknown[]; error?: { message: string } } };
  };
}

const roleAccount = async (t: T, role: string) => (await prisma.accountRole.findFirstOrThrow({ where: { organizationId: t.org.id, role: role as never }, select: { accountId: true } })).accountId;
const who = (t: T) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test" });

test("expense, charge suggestion, transfer and category routes through the API; a repeat with the same key is the same document", async () => {
  const expenses = await import("../../app/api/v1/accounting/expenses/route.ts");
  const pay = await import("../../app/api/v1/accounting/expenses/[id]/pay/route.ts");
  const charge = await import("../../app/api/v1/money-accounts/charge/route.ts");
  const transfers = await import("../../app/api/v1/accounting/transfers/route.ts");
  const categories = await import("../../app/api/v1/accounting/expense-categories/route.ts");
  const chargeRules = await import("../../app/api/v1/settings/charges/route.ts");
  await withTestOrg(async (t) => {
    const call = await caller(t);
    const bkash = await createBankAccount({ ...t.actor, idempotencyKey: randomUUID(), name: "bKash", kind: "MOBILE", accountNumber: "01711-000000", openingAmount: "5000.00" });
    assert.equal(bkash.ok, true, JSON.stringify(bkash));
    const wallet = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: "bKash" } });
    const cash = await roleAccount(t, "CASH");

    // a rule through the settings route, then the suggestion the forms use
    assert.equal((await call(chargeRules.POST, "/api/v1/settings/charges", { body: { accountId: wallet.id, percent: "1.85", fixed: "0", bearer: "SHOP" } })).status, 200);
    assert.equal((await call(chargeRules.POST, "/api/v1/settings/charges", { body: { accountId: cash, percent: "1", fixed: "0", bearer: "SHOP" } })).status, 404, "a cash account has no charge rule");
    const rules = await call(chargeRules.GET, "/api/v1/settings/charges", { method: "GET" });
    assert.deepEqual((rules.body.data as unknown as Array<{ name: string; percent: string }>).map((rule) => [rule.name, rule.percent]), [["Bank (default)", "0.00"], ["bKash", "1.85"]], "the default bank account is listed too, with no charge");
    const suggestion = await call(charge.GET, `/api/v1/money-accounts/charge?accountId=${wallet.id}&amount=1000.00`, { method: "GET" });
    assert.deepEqual([suggestion.status, suggestion.body.data?.charge, suggestion.body.data?.kind], [200, "18.50", "MOBILE"]);
    assert.equal((await call(charge.GET, "/api/v1/money-accounts/charge?accountId=nope&amount=1", { method: "GET" })).status, 400);

    // an expense paid from the wallet with the suggested charge; the same key twice is one expense
    const list = await call(categories.GET, "/api/v1/accounting/expense-categories", { method: "GET" });
    const transport = (list.body.data?.categories as unknown as Array<{ id: string; name: string }>).find((category) => category.name === "Transport");
    assert.ok(transport && (list.body.data?.accounts as unknown[]).length > 0);
    const key = randomUUID();
    const body = { businessDate: today(), categoryId: transport.id, moneyAccountId: wallet.id, amount: "1000.00", charge: "18.50", note: "Courier drop" };
    const first = await call(expenses.POST, "/api/v1/accounting/expenses", { body, key });
    const again = await call(expenses.POST, "/api/v1/accounting/expenses", { body, key });
    assert.deepEqual([first.status, again.status, first.body.data?.id === again.body.data?.id, again.body.data?.replayed], [201, 200, true, true]);
    assert.equal((await call(expenses.POST, "/api/v1/accounting/expenses", { body, key: null })).status, 400, "a write needs its Idempotency-Key");
    assert.equal((await call(expenses.POST, "/api/v1/accounting/expenses", { body: { ...body, amount: "0" } })).status, 422);
    const shown = await call(expenses.GET, `/api/v1/accounting/expenses?periodMonth=${today().slice(0, 7)}`, { method: "GET" });
    assert.deepEqual((shown.body.data as unknown as Array<{ category: string; amount: string; charge: string }>).map((row) => [row.category, row.amount, row.charge]), [["Transport", "1000.00", "18.50"]]);

    // a draft of a recurring expense paid through its route
    const rent = (await listCategories(t.org.id)).find((category) => category.name === "Rent");
    assert.ok(rent);
    await saveRecurring(who(t), { categoryId: rent.id, amount: "700.00", dayOfMonth: 3 });
    const month = addDays(today(), -35).slice(0, 7);
    await generateDrafts(who(t), month);
    const draft = await prisma.expense.findFirstOrThrow({ where: { organizationId: t.org.id, status: "DRAFT" } });
    const paid = await call(pay.POST, `/api/v1/accounting/expenses/${draft.id}/pay`, { body: { businessDate: today(), moneyAccountId: cash }, params: { id: draft.id } });
    assert.deepEqual([paid.status, (await prisma.expense.findUniqueOrThrow({ where: { id: draft.id } })).amount.toFixed(2)], [201, "700.00"], "the draft's own amount when none is given");

    // a transfer, with the sender's charge
    const move = await call(transfers.POST, "/api/v1/accounting/transfers", { body: { businessDate: today(), fromAccountId: wallet.id, toAccountId: cash, amount: "500.00", charge: "9.25" } });
    assert.equal(move.status, 201, JSON.stringify(move.body));
    const listed = await call(transfers.GET, "/api/v1/accounting/transfers", { method: "GET" });
    assert.deepEqual((listed.body.data as unknown as Array<{ from: string; to: string; amount: string; charge: string }>).map((row) => [row.from, row.amount, row.charge]), [["bKash", "500.00", "9.25"]]);
    assert.equal((await call(transfers.POST, "/api/v1/accounting/transfers", { body: { businessDate: today(), fromAccountId: cash, toAccountId: cash, amount: "5.00" } })).status, 422);

    // a category through the settings permission
    const made = await call(categories.POST, "/api/v1/accounting/expense-categories", { body: { name: "Packaging", accountId: (list.body.data?.accounts as unknown as Array<{ id: string; code: string }>).find((a) => a.code === "6900")?.id, type: "VARIABLE" } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal((await call(categories.POST, "/api/v1/accounting/expense-categories", { body: { name: "Packaging", accountId: (list.body.data?.accounts as unknown as Array<{ id: string; code: string }>)[0].id, type: "VARIABLE" } })).status, 409, "a name is used once");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the month-end accrual route needs expenses.accrue; the shift rule needs settings.manage and takes effect", async () => {
  const accrue = await import("../../app/api/v1/accounting/expenses/accrue/route.ts");
  const shiftRule = await import("../../app/api/v1/settings/shifts/route.ts");
  const month = addDays(today(), -35).slice(0, 7);
  await withTestOrg(
    async (t) => {
      const call = await caller(t);
      assert.equal((await call(accrue.POST, "/api/v1/accounting/expenses/accrue", { body: { periodMonth: month } })).status, 403);
      assert.equal((await call(shiftRule.POST, "/api/v1/settings/shifts", { body: { requireShift: true } })).status, 403);
    },
    { permissions: ["accounting.view", "accounting.post"] },
  );
  await withTestOrg(async (t) => {
    const call = await caller(t);
    const rent = (await listCategories(t.org.id)).find((category) => category.name === "Rent");
    assert.ok(rent);
    await saveRecurring(who(t), { categoryId: rent.id, amount: "900.00", dayOfMonth: 1 });
    await generateDrafts(who(t), month);
    const key = randomUUID();
    const done = await call(accrue.POST, "/api/v1/accounting/expenses/accrue", { body: { periodMonth: month }, key });
    assert.deepEqual([done.status, done.body.data?.count, done.body.data?.total], [201, 1, "900.00"]);
    assert.deepEqual((await call(accrue.POST, "/api/v1/accounting/expenses/accrue", { body: { periodMonth: month }, key })).body.data?.replayed, true);
    assert.equal((await call(accrue.POST, "/api/v1/accounting/expenses/accrue", { body: { periodMonth: "2026-13" } })).status, 400);
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: t.org.id } })).requireShift, false, "off until the owner turns it on");
    assert.equal((await call(shiftRule.POST, "/api/v1/settings/shifts", { body: { requireShift: true } })).status, 200);
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: t.org.id } })).requireShift, true);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
