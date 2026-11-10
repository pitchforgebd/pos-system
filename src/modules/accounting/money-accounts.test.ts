import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { MONEY_ACCOUNT_RANGES } from "../../core/ledger/accounts.ts";
import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today, fiscalYear } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { accountStatement, cashBankBalances, createBankAccount, defaultStatementRange, openingCashEntered, postOpeningCash } from "./books.ts";

// P02 task 11: the owner's bank and mobile-banking accounts. Each is an account of its own (banks numbered in one range, mobile
// accounts in another), carries the details people look for (bank, branch, account number), starts from an opening amount that
// goes against Opening Balance Equity, and has its own ledger.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const who = (t: T) => ({ ip: "127.0.0.1", userAgent: "test", organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, idempotencyKey: randomUUID() });
const inRange = (code: string, range: { from: number; to: number }) => Number(code) >= range.from && Number(code) <= range.to;

test("a bank account keeps its bank, branch and number, starts from its opening amount, and has a ledger", async () => {
  await withTestOrg(async (t) => {
    const made = await createBankAccount({ ...who(t), name: "DBBL Current", kind: "BANK", bankName: "Dutch-Bangla Bank", bankBranch: "Gulshan", accountNumber: "123 456 7890", openingAmount: "500.00" });
    assert.equal(made.ok, true, JSON.stringify(made));
    const account = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: "DBBL Current" } });
    assert.deepEqual([account.kind, account.bankName, account.bankBranch, account.accountNumber], ["BANK", "Dutch-Bangla Bank", "Gulshan", "123 456 7890"]);
    assert.ok(inRange(account.code, MONEY_ACCOUNT_RANGES.BANK), `bank code ${account.code}`);

    const row = (await cashBankBalances(t.org.id, t.branch.id)).find((r) => r.code === account.code);
    assert.deepEqual([row?.balance, row?.kind, row?.bankName, row?.bankBranch, row?.accountNumber], ["500.00", "BANK", "Dutch-Bangla Bank", "Gulshan", "123 456 7890"]);

    const ledger = await accountStatement({ organizationId: t.org.id, branchId: t.branch.id, accountCode: account.code, from: today(), to: today() });
    assert.deepEqual(ledger?.lines.map((line) => [line.debit, line.credit, line.balance]), [["500.00", "0.00", "500.00"]], "the opening amount is the first line of its ledger");
    await assertBooksReconcile(t.org.id);
  });
});

test("a mobile banking account is its own kind, in its own number range", async () => {
  await withTestOrg(async (t) => {
    const made = await createBankAccount({ ...who(t), name: "bKash Personal", kind: "MOBILE", accountNumber: "01700-000000", openingAmount: "100.00" });
    assert.equal(made.ok, true, JSON.stringify(made));
    const account = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: "bKash Personal" } });
    assert.equal(account.kind, "MOBILE");
    assert.ok(inRange(account.code, MONEY_ACCOUNT_RANGES.MOBILE), `mobile code ${account.code}`);
    assert.equal((await cashBankBalances(t.org.id, t.branch.id)).find((r) => r.code === account.code)?.balance, "100.00");
    await assertBooksReconcile(t.org.id);
  });
});

test("banks and mobile accounts are numbered one after another within their own ranges", async () => {
  await withTestOrg(async (t) => {
    for (const [name, kind] of [["Bank A", "BANK"], ["Wallet A", "MOBILE"], ["Bank B", "BANK"], ["Wallet B", "MOBILE"]] as const) {
      assert.equal((await createBankAccount({ ...who(t), name, kind })).ok, true, name);
    }
    const codes = async (kind: "BANK" | "MOBILE") => (await prisma.account.findMany({ where: { organizationId: t.org.id, kind, isSystem: false }, orderBy: { code: "asc" }, select: { code: true } })).map((a) => Number(a.code));
    const banks = await codes("BANK");
    const wallets = await codes("MOBILE");
    assert.deepEqual(banks, [MONEY_ACCOUNT_RANGES.BANK.from, MONEY_ACCOUNT_RANGES.BANK.from + 1]);
    assert.deepEqual(wallets, [MONEY_ACCOUNT_RANGES.MOBILE.from, MONEY_ACCOUNT_RANGES.MOBILE.from + 1]);
  });
});

test("the same name twice is refused, whichever kind it is; a bad kind or account number is refused", async () => {
  await withTestOrg(async (t) => {
    assert.equal((await createBankAccount({ ...who(t), name: "Shared Name", kind: "BANK" })).ok, true);
    const again = await createBankAccount({ ...who(t), name: "Shared Name", kind: "MOBILE" });
    assert.deepEqual([again.ok, again.ok ? 0 : again.status], [false, 409]);
    const markup = await createBankAccount({ ...who(t), name: "Markup", accountNumber: "<script>" });
    assert.equal(markup.ok, false);
    const longNumber = await createBankAccount({ ...who(t), name: "Long", accountNumber: "1".repeat(65) });
    assert.equal(longNumber.ok, false);
    const kind = await createBankAccount({ ...who(t), name: "Odd", kind: "CASH" as never });
    assert.equal(kind.ok, false, "only a bank or a mobile account can be added; the cash drawer is the system's");
    assert.equal(await prisma.account.count({ where: { organizationId: t.org.id, name: { in: ["Markup", "Long", "Odd"] } } }), 0, "a refused account leaves nothing behind");
  });
});

test("opening cash is entered once per branch, and the page can tell whether it was", async () => {
  await withTestOrg(async (t) => {
    assert.equal(await openingCashEntered(t.org.id, t.branch.id), false);
    assert.equal((await postOpeningCash({ ...who(t), amount: "250.00" })).ok, true);
    assert.equal(await openingCashEntered(t.org.id, t.branch.id), true);
    const other = await prisma.branch.create({ data: { organizationId: t.org.id, name: "Second" } });
    assert.equal(await openingCashEntered(t.org.id, other.id), false, "each branch has its own drawer");
    await assertBooksReconcile(t.org.id);
  });
});

test("an account's ledger opens on the current fiscal year up to today, so a link needs no dates", async () => {
  await withTestOrg(async (t) => {
    const range = await defaultStatementRange(t.org.id);
    assert.equal(range.to, today());
    assert.equal(range.from, fiscalYear(today(), 7).start, "July to June by default");
    await prisma.organization.update({ where: { id: t.org.id }, data: { fiscalYearStartMonth: 1 } });
    assert.equal((await defaultStatementRange(t.org.id)).from, `${today().slice(0, 4)}-01-01`);
  });
});
