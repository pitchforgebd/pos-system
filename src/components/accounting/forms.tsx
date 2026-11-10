"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

/** `kind` is CASH, BANK, MOBILE or OTHER, sent for the cash and bank pickers so the form never looks at an account number. */
type AccountOption = { code: string; label: string; kind?: string };
type GroupOption = { code: string; name: string };

export function JournalForm({ accounts }: { accounts: AccountOption[] }) {
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit<{ id: string }>(
          {
            url: "/api/v1/accounting/journals",
            body: {
              businessDate: form.get("businessDate"),
              description: form.get("description"),
              lines: [
                { accountCode: form.get("debitAccount"), debit: form.get("amount"), credit: "0.00" },
                { accountCode: form.get("creditAccount"), debit: "0.00", credit: form.get("amount") },
              ],
            },
          },
          { goTo: (data) => `/accounting/journals/${data.id}` },
        );
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Date" />
      <Input name="description" placeholder="Description" aria-label="Description" />
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <label className="grid gap-1 text-sm">
        Debit account
        <select name="debitAccount" required className="h-10 rounded-md border border-border bg-surface px-2">
          {accounts.map((account) => (
            <option key={account.code} value={account.code}>{account.label}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Credit account
        <select name="creditAccount" required className="h-10 rounded-md border border-border bg-surface px-2">
          {accounts.map((account) => (
            <option key={account.code} value={account.code}>{account.label}</option>
          ))}
        </select>
      </label>
      <p className="text-sm text-muted">The server posts the journal only when debit equals credit.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={accounts.length < 2}>Post journal</Button>
    </form>
  );
}

export function ExpenseForm({ accounts }: { accounts: AccountOption[] }) {
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/accounting/expenses",
          body: {
            businessDate: form.get("businessDate"),
            accountCode: form.get("accountCode"),
            amount: form.get("amount"),
            method: form.get("method"),
            note: String(form.get("note") || "") || undefined,
          },
        });
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Date" />
      <label className="grid gap-1 text-sm">
        Expense account
        <select name="accountCode" required className="h-10 rounded-md border border-border bg-surface px-2">
          {accounts.map((account) => (
            <option key={account.code} value={account.code}>{account.label}</option>
          ))}
        </select>
      </label>
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <label className="grid gap-1 text-sm">
        Method
        <select name="method" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="CASH">
          <option value="CASH">Cash</option>
          <option value="BANK">Bank</option>
        </select>
      </label>
      <Input name="note" placeholder="Note" aria-label="Note" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={accounts.length === 0}>Post expense</Button>
    </form>
  );
}

export function ContraForm() {
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/accounting/contras",
          body: {
            businessDate: form.get("businessDate"),
            direction: form.get("direction"),
            amount: form.get("amount"),
          },
        });
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Date" />
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <label className="grid gap-1 text-sm">
        Direction
        <select name="direction" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="CASH_TO_BANK">
          <option value="CASH_TO_BANK">Cash to bank</option>
          <option value="BANK_TO_CASH">Bank to cash</option>
        </select>
      </label>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>Post transfer</Button>
    </form>
  );
}

export function AccountForm({ groups }: { groups: GroupOption[] }) {
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/accounting/accounts",
          body: { code: form.get("code"), name: form.get("name"), groupCode: form.get("groupCode") },
        });
      }}
    >
      <Input name="code" required placeholder="Code" aria-label="Code" />
      <Input name="name" required placeholder="Name" aria-label="Name" />
      <label className="grid gap-1 text-sm">
        Group
        <select name="groupCode" required className="h-10 rounded-md border border-border bg-surface px-2">
          {groups.map((group) => (
            <option key={group.code} value={group.code}>{group.code} · {group.name}</option>
          ))}
        </select>
      </label>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" variant="secondary" loading={pending} disabled={groups.length === 0}>Add account</Button>
    </form>
  );
}

export function ReverseForm({ journalId }: { journalId: string }) {
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit<{ id: string }>(
          { url: `/api/v1/accounting/journals/${journalId}/reverse`, body: { businessDate: form.get("businessDate") } },
          { goTo: (data) => `/accounting/journals/${data.id}` },
        );
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Reversal date" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" variant="secondary" loading={pending}>Reverse journal</Button>
    </form>
  );
}

function AccountSelect({ name, label, accounts }: { name: string; label: string; accounts: AccountOption[] }) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <select name={name} required className="h-10 rounded-md border border-border bg-surface px-2">
        {accounts.map((account) => (
          <option key={account.code} value={account.code}>{account.label}</option>
        ))}
      </select>
    </label>
  );
}

function MethodSelect({ moneyAccounts }: { moneyAccounts: AccountOption[] }) {
  const banks = moneyAccounts.filter((account) => account.kind === "BANK" || account.kind === "MOBILE");
  return (
    <>
      <label className="grid gap-1 text-sm">
        Method
        <select name="method" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="CASH">
          <option value="CASH">Cash</option>
          <option value="BANK">Bank</option>
        </select>
      </label>
      {banks.length > 0 ? (
        <label className="grid gap-1 text-sm">
          Bank
          <select name="bankCode" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue={banks[0]?.code}>
            {banks.map((account) => (
              <option key={account.code} value={account.code}>{account.label}</option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}

export function IncomeForm({ accounts, moneyAccounts }: { accounts: AccountOption[]; moneyAccounts: AccountOption[] }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/accounting/incomes",
          body: {
            businessDate: form.get("businessDate"),
            accountCode: form.get("accountCode"),
            amount: form.get("amount"),
            method: form.get("method"),
            bankCode: form.get("bankCode") || undefined,
            category: String(form.get("category") || "") || undefined,
            note: String(form.get("note") || "") || undefined,
          },
        });
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Date" />
      <AccountSelect name="accountCode" label="Income account" accounts={accounts} />
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <MethodSelect moneyAccounts={moneyAccounts} />
      <Input name="category" placeholder="Category" aria-label="Category" />
      <Input name="note" placeholder="Note" aria-label="Note" />
      <p className="text-sm text-muted">Cash or bank is debited. The income account is credited. Sales stay on invoices.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={accounts.length === 0}>Post income</Button>
    </form>
  );
}

export function CapitalForm({ moneyAccounts }: { moneyAccounts: AccountOption[] }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/accounting/capitals",
          body: {
            businessDate: form.get("businessDate"),
            capitalType: form.get("capitalType"),
            ownerName: form.get("ownerName"),
            amount: form.get("amount"),
            method: form.get("method"),
            bankCode: form.get("bankCode") || undefined,
          },
        });
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Date" />
      <Input name="ownerName" required placeholder="Owner name" aria-label="Owner name" />
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <label className="grid gap-1 text-sm">
        Type
        <select name="capitalType" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="ADDED">
          <option value="ADDED">Capital added</option>
          <option value="WITHDRAW">Capital withdrawn</option>
        </select>
      </label>
      <MethodSelect moneyAccounts={moneyAccounts} />
      <p className="text-sm text-muted">Added capital debits cash or bank and credits owner capital. A withdrawal debits drawings.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>Post capital</Button>
    </form>
  );
}

export function LoanForm({ moneyAccounts }: { moneyAccounts: AccountOption[] }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/accounting/loans",
          body: {
            businessDate: form.get("businessDate"),
            direction: form.get("direction"),
            lender: form.get("lender"),
            amount: form.get("amount"),
            method: form.get("method"),
            bankCode: form.get("bankCode") || undefined,
          },
        });
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Date" />
      <Input name="lender" required placeholder="Lender" aria-label="Lender" />
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <label className="grid gap-1 text-sm">
        Direction
        <select name="direction" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="RECEIVED">
          <option value="RECEIVED">Loan received</option>
          <option value="PAID">Loan paid</option>
        </select>
      </label>
      <MethodSelect moneyAccounts={moneyAccounts} />
      <p className="text-sm text-muted">A loan received debits cash or bank and credits loans. A payment does the opposite.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>Post loan</Button>
    </form>
  );
}

export function CashVoucherForm({ accounts, moneyAccounts }: { accounts: AccountOption[]; moneyAccounts: AccountOption[] }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/accounting/vouchers",
          body: {
            businessDate: form.get("businessDate"),
            voucherType: form.get("voucherType"),
            accountCode: form.get("accountCode"),
            amount: form.get("amount"),
            method: form.get("method"),
            bankCode: form.get("bankCode") || undefined,
          },
        });
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Date" />
      <label className="grid gap-1 text-sm">
        Voucher
        <select name="voucherType" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="PAYMENT">
          <option value="PAYMENT">Payment</option>
          <option value="RECEIPT">Receipt</option>
        </select>
      </label>
      <AccountSelect name="accountCode" label="Other account" accounts={accounts} />
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <MethodSelect moneyAccounts={moneyAccounts} />
      <p className="text-sm text-muted">A payment credits cash or bank. A receipt debits cash or bank. Customer and supplier balances stay on their own screens.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={accounts.length === 0}>Post voucher</Button>
    </form>
  );
}

/** Adds a bank or a mobile banking account (bKash, Nagad, ...), with the details people look for and an optional opening amount. */
export function BankForm() {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const text = (name: string) => String(form.get(name) || "").trim() || undefined;
        void submit({
          url: "/api/v1/accounting/banks",
          body: {
            name: form.get("name"),
            kind: form.get("kind"),
            bankName: text("bankName"),
            bankBranch: text("bankBranch"),
            accountNumber: text("accountNumber"),
            openingAmount: text("openingAmount"),
          },
        });
      }}
    >
      <label className="grid gap-1 text-sm">
        Type
        <select name="kind" defaultValue="BANK" className="h-10 rounded-md border border-border bg-surface px-2">
          <option value="BANK">Bank account</option>
          <option value="MOBILE">Mobile banking (bKash, Nagad, ...)</option>
        </select>
      </label>
      <Input name="name" required placeholder="Account name, e.g. DBBL Current or bKash Personal" aria-label="Account name" />
      <Input name="bankName" placeholder="Bank (for a bank account)" aria-label="Bank" />
      <Input name="bankBranch" placeholder="Branch (for a bank account)" aria-label="Bank branch" />
      <Input name="accountNumber" placeholder="Account or wallet number" aria-label="Account number" />
      <Input name="openingAmount" placeholder="Opening amount" aria-label="Opening amount" />
      <p className="text-sm text-muted">Each account gets a number of its own, banks and mobile accounts in separate ranges. An opening amount debits the account and credits Opening Balance Equity, so the owner&apos;s capital is not touched.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>Add account</Button>
    </form>
  );
}

/** The cash in the drawer when the books start, entered once per branch. */
export function OpeningCashForm() {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({ url: "/api/v1/accounting/opening-cash", body: { amount: String(form.get("amount") || "").trim() } });
      }}
    >
      <Input name="amount" required placeholder="Cash in the drawer today" aria-label="Opening cash" />
      <p className="text-sm text-muted">Enter this once for the branch when the books start. It debits Cash in Hand and credits Opening Balance Equity. Cash after that comes from sales, receipts and the owner&apos;s capital.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" variant="secondary" loading={pending}>Save opening cash</Button>
    </form>
  );
}
