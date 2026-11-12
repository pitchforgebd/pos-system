"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFormSubmit } from "@/lib/client/use-form-submit";
import { chargeHint, useChargeSuggestion } from "@/lib/client/use-charge";

type Option = { id: string; label: string };
export type MoneyOption = Option & { kind: "CASH" | "BANK" | "MOBILE" };

/** The account money goes out of, the amount, and the charge the bank or mobile service takes (proposed from its rule; the user may change it). */
function useMoneyOut(accounts: MoneyOption[], initialAmount = "") {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState(initialAmount);
  const [typed, setTyped] = useState<string | null>(null);
  const kind = accounts.find((account) => account.id === accountId)?.kind ?? "CASH";
  const suggestion = useChargeSuggestion(kind === "CASH" ? "" : accountId, amount);
  const proposed = suggestion && Number(suggestion.charge) > 0 ? suggestion.charge : "";
  return {
    accountId,
    amount,
    kind,
    charge: kind === "CASH" ? "" : (typed ?? proposed),
    hint: kind === "CASH" ? "" : chargeHint(suggestion),
    setAmount,
    pick: (id: string) => {
      setAccountId(id);
      setTyped(null);
    },
    edit: setTyped,
  };
}

type MoneyOut = ReturnType<typeof useMoneyOut>;

function AccountAndCharge({ accounts, state, label }: { accounts: MoneyOption[]; state: MoneyOut; label: string }) {
  return (
    <>
      <label className="grid gap-1 text-sm">
        {label}
        <Select name="moneyAccountId" required value={state.accountId} onChange={(event) => state.pick(event.target.value)} aria-label={label}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </Select>
      </label>
      {state.kind !== "CASH" ? (
        <label className="grid gap-1 text-sm">
          Charge the bank or mobile service takes
          <Input name="charge" value={state.charge} onChange={(event) => state.edit(event.target.value)} placeholder="0.00" aria-label="Charge" inputMode="decimal" />
          {state.hint ? <span className="text-xs text-muted">{state.hint}</span> : null}
        </label>
      ) : null}
    </>
  );
}

const chargeOrNothing = (state: MoneyOut) => (state.kind === "CASH" || state.charge.trim() === "" ? undefined : state.charge.trim());

/** An expense paid now. It belongs to the month in "Month" (October's rent paid in November is October's). */
export function ExpenseForm({ categories, accounts, today }: { categories: Option[]; accounts: MoneyOption[]; today: string }) {
  const money = useMoneyOut(accounts);
  const form = useFormSubmit("/api/v1/accounting/expenses", (data) => ({
    businessDate: data.get("businessDate"),
    categoryId: data.get("categoryId"),
    amount: money.amount,
    moneyAccountId: money.accountId,
    charge: chargeOrNothing(money),
    periodMonth: String(data.get("periodMonth") || "") || undefined,
    note: String(data.get("note") || "") || undefined,
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Date
          <Input name="businessDate" type="date" required defaultValue={today} />
        </label>
        <label className="grid gap-1 text-sm">
          Month it belongs to
          <Input name="periodMonth" type="month" defaultValue={today.slice(0, 7)} />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        Category
        <Select name="categoryId" required aria-label="Category" defaultValue="">
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1 text-sm">
        Amount
        <Input name="amount" required placeholder="Amount" aria-label="Amount" inputMode="decimal" value={money.amount} onChange={(event) => money.setAmount(event.target.value)} />
      </label>
      <AccountAndCharge accounts={accounts} state={money} label="Paid from" />
      <Input name="note" placeholder="Note" aria-label="Note" />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending} disabled={categories.length === 0 || accounts.length === 0}>
        Pay expense
      </Button>
    </form>
  );
}

/** The "pay" button of a recurring expense's draft: the amount may be changed. */
export function PayDraftForm({ id, amount, accounts, today }: { id: string; amount: string; accounts: MoneyOption[]; today: string }) {
  const money = useMoneyOut(accounts, amount);
  const form = useFormSubmit(`/api/v1/accounting/expenses/${id}/pay`, (data) => ({
    businessDate: data.get("businessDate"),
    moneyAccountId: money.accountId,
    amount: money.amount,
    charge: chargeOrNothing(money),
  }));
  return (
    <details className="rounded-md border border-border p-2">
      <summary className="cursor-pointer text-sm font-medium">Pay</summary>
      <form className="mt-2 grid max-w-md gap-2" onSubmit={form.onSubmit}>
        <Input name="businessDate" type="date" required defaultValue={today} aria-label="Date" />
        <Input name="amount" required value={money.amount} onChange={(event) => money.setAmount(event.target.value)} aria-label="Amount" inputMode="decimal" />
        <AccountAndCharge accounts={accounts} state={money} label="Paid from" />
        {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
        <Button type="submit" size="sm" loading={form.pending} disabled={accounts.length === 0}>
          Pay
        </Button>
      </form>
    </details>
  );
}

/** Pays an expense that was booked as owed at month end (Dr Accrued Expenses / Cr the account). */
export function SettleForm({ id, amount, accounts, today }: { id: string; amount: string; accounts: MoneyOption[]; today: string }) {
  const money = useMoneyOut(accounts, amount);
  const form = useFormSubmit(`/api/v1/accounting/expenses/${id}/settle`, (data) => ({ businessDate: data.get("businessDate"), moneyAccountId: money.accountId, charge: chargeOrNothing(money) }));
  return (
    <details className="rounded-md border border-border p-2">
      <summary className="cursor-pointer text-sm font-medium">Pay the {amount} owed</summary>
      <form className="mt-2 grid max-w-md gap-2" onSubmit={form.onSubmit}>
        <Input name="businessDate" type="date" required defaultValue={today} aria-label="Date" />
        <AccountAndCharge accounts={accounts} state={money} label="Paid from" />
        {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
        <Button type="submit" size="sm" loading={form.pending} disabled={accounts.length === 0}>
          Pay
        </Button>
      </form>
    </details>
  );
}

/** The owner's month-end click: what is still unpaid for the month is booked as owed. */
export function AccrueForm({ month }: { month: string }) {
  const form = useFormSubmit("/api/v1/accounting/expenses/accrue", (data) => ({ periodMonth: data.get("periodMonth") }));
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={form.onSubmit}>
      <label className="grid gap-1 text-sm">
        Month
        <Input name="periodMonth" type="month" required defaultValue={month} />
      </label>
      <Button type="submit" variant="secondary" loading={form.pending}>
        Book what is unpaid as owed
      </Button>
      {form.message ? <p className="w-full text-sm text-error">{form.message}</p> : null}
    </form>
  );
}

/** A fixed expense that comes every month (rent, salary): each month a draft is made for it. */
export function RecurringForm({ categories, initial }: { categories: Option[]; initial?: { id: string; categoryId: string; amount: string; dayOfMonth: number; note: string | null; active: boolean } }) {
  const form = useFormSubmit("/api/v1/accounting/recurring-expenses", (data) => ({
    id: initial?.id,
    categoryId: data.get("categoryId"),
    amount: data.get("amount"),
    dayOfMonth: Number(data.get("dayOfMonth")),
    note: String(data.get("note") || "") || undefined,
    ...(initial ? { active: data.get("active") === "on" } : {}),
  }));
  return (
    <form className="grid max-w-3xl gap-2 sm:grid-cols-[1fr_8rem_6rem_1fr_auto]" onSubmit={form.onSubmit}>
      <Select name="categoryId" required aria-label="Category" defaultValue={initial?.categoryId ?? ""}>
        <option value="" disabled>
          Category
        </option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
      </Select>
      <Input name="amount" required placeholder="Amount" aria-label="Amount" inputMode="decimal" defaultValue={initial?.amount} />
      <Input name="dayOfMonth" required type="number" min={1} max={31} aria-label="Day of the month" defaultValue={initial?.dayOfMonth ?? 1} />
      <Input name="note" placeholder="Note" aria-label="Note" defaultValue={initial?.note ?? ""} />
      <div className="flex items-center gap-2">
        {initial ? (
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="active" defaultChecked={initial.active} /> Active
          </label>
        ) : null}
        <Button type="submit" size="sm" variant={initial ? "secondary" : "primary"} loading={form.pending}>
          {initial ? "Save" : "Add"}
        </Button>
      </div>
      {form.message ? <p className="text-sm text-error sm:col-span-5">{form.message}</p> : null}
    </form>
  );
}

/** An expense category: its name, the expense account it posts to, and whether it is a fixed, variable or miscellaneous cost. */
export function CategoryForm({ accounts, initial }: { accounts: Option[]; initial?: { id: string; name: string; accountId: string; type: string; active: boolean } }) {
  const form = useFormSubmit("/api/v1/accounting/expense-categories", (data) => ({
    id: initial?.id,
    name: data.get("name"),
    accountId: data.get("accountId"),
    type: data.get("type"),
    ...(initial ? { active: data.get("active") === "on" } : {}),
  }));
  return (
    <form className="grid max-w-3xl gap-2 sm:grid-cols-[1fr_1fr_9rem_auto]" onSubmit={form.onSubmit}>
      <Input name="name" required placeholder="Category name" aria-label="Category name" defaultValue={initial?.name} />
      <Select name="accountId" required aria-label="Expense account" defaultValue={initial?.accountId ?? ""}>
        <option value="" disabled>
          Expense account
        </option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label}
          </option>
        ))}
      </Select>
      <Select name="type" aria-label="Type" defaultValue={initial?.type ?? "VARIABLE"}>
        <option value="MONTHLY_FIXED">Fixed monthly</option>
        <option value="VARIABLE">Variable</option>
        <option value="MISC">Miscellaneous</option>
      </Select>
      <div className="flex items-center gap-2">
        {initial ? (
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="active" defaultChecked={initial.active} /> Active
          </label>
        ) : null}
        <Button type="submit" size="sm" variant={initial ? "secondary" : "primary"} loading={form.pending}>
          {initial ? "Save" : "Add"}
        </Button>
      </div>
      {form.message ? <p className="text-sm text-error sm:col-span-4">{form.message}</p> : null}
    </form>
  );
}

/** Money moved between the shop's own accounts. The sender's charge is proposed from its rule. */
export function TransferForm({ accounts, today }: { accounts: MoneyOption[]; today: string }) {
  const money = useMoneyOut(accounts);
  const [toId, setToId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? "");
  const form = useFormSubmit("/api/v1/accounting/transfers", (data) => ({
    businessDate: data.get("businessDate"),
    fromAccountId: money.accountId,
    toAccountId: toId,
    amount: money.amount,
    charge: chargeOrNothing(money),
    note: String(data.get("note") || "") || undefined,
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Input name="businessDate" type="date" required defaultValue={today} aria-label="Date" />
      <AccountAndCharge accounts={accounts} state={money} label="From" />
      <label className="grid gap-1 text-sm">
        To
        <Select value={toId} onChange={(event) => setToId(event.target.value)} aria-label="To">
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1 text-sm">
        Amount
        <Input name="amount" required placeholder="Amount" aria-label="Amount" inputMode="decimal" value={money.amount} onChange={(event) => money.setAmount(event.target.value)} />
      </label>
      <Input name="note" placeholder="Note" aria-label="Note" />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending} disabled={accounts.length < 2 || money.accountId === toId}>
        Move money
      </Button>
    </form>
  );
}

/** What a bank or mobile account takes on a payment: a percentage, a fixed part, and who bears it. */
export function ChargeRuleForm({ rule }: { rule: { accountId: string; name: string; kind: string; percent: string; fixed: string; bearer: "SHOP" | "CUSTOMER" } }) {
  const form = useFormSubmit("/api/v1/settings/charges", (data) => ({ accountId: rule.accountId, percent: data.get("percent"), fixed: data.get("fixed"), bearer: data.get("bearer") }));
  return (
    <form className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_7rem_7rem_9rem_auto] sm:items-end" onSubmit={form.onSubmit}>
      <p className="text-sm font-medium">
        {rule.name} <span className="text-muted">({rule.kind === "MOBILE" ? "mobile banking" : "bank"})</span>
      </p>
      <label className="grid gap-1 text-xs">
        Percent
        <Input name="percent" required defaultValue={rule.percent} inputMode="decimal" aria-label={`${rule.name} charge percent`} />
      </label>
      <label className="grid gap-1 text-xs">
        Fixed
        <Input name="fixed" required defaultValue={rule.fixed} inputMode="decimal" aria-label={`${rule.name} fixed charge`} />
      </label>
      <label className="grid gap-1 text-xs">
        Who bears it
        <Select name="bearer" defaultValue={rule.bearer} aria-label={`${rule.name} bearer`}>
          <option value="SHOP">The shop</option>
          <option value="CUSTOMER">The customer</option>
        </Select>
      </label>
      <Button type="submit" size="sm" variant="secondary" loading={form.pending}>
        Save
      </Button>
      {form.message ? <p className="text-sm text-error sm:col-span-5">{form.message}</p> : null}
    </form>
  );
}

/** Whether cash may move only while the user has an open shift (D17). */
export function ShiftRuleForm({ requireShift }: { requireShift: boolean }) {
  const form = useFormSubmit("/api/v1/settings/shifts", (data) => ({ requireShift: data.get("requireShift") === "on" }));
  return (
    <form className="grid max-w-xl gap-2" onSubmit={form.onSubmit}>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="requireShift" defaultChecked={requireShift} />
        Cash can be taken or paid only while the user has an open shift
      </label>
      <p className="text-xs text-muted">Off: a shift is optional, and cash moves without one. On: the register, collections and payments in cash ask the user to open a shift first. Turning it on does not change old entries.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" size="sm" variant="secondary" loading={form.pending}>
        Save
      </Button>
    </form>
  );
}
