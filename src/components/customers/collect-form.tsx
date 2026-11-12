"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

// Taking a due (P06 task 6, #18): find the customer, see what they still owe invoice by invoice, say which invoices the money is for (or leave
// it to settle the oldest first), the account it came into, and the charge the bank or mobile service kept (D7, the shop's expense).

type Customer = { id: string; name: string; phone: string | null; outstanding: string; advance: string };
type Open = { id: string; number: string | null; businessDate: string; total: string; owed: string; status: string };
type Account = { id: string; label: string; kind: "CASH" | "BANK" | "MOBILE" };

const select = "h-10 rounded-md border border-border bg-surface px-2";

export function CollectForm({ accounts, today }: { accounts: Account[]; today: string }) {
  const { submit, pending, message, reset } = useSubmit();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<Open[]>([]);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [charge, setCharge] = useState("");
  const account = accounts.find((row) => row.id === accountId);

  useEffect(() => {
    if (query.trim() === "") {
      return;
    }
    const handle = setTimeout(() => {
      void fetch(`/api/v1/search/customers?q=${encodeURIComponent(query.trim())}`)
        .then((response) => (response.ok ? response.json() : { data: [] }))
        .then((body: { data: Customer[] }) => setFound(body.data ?? []))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);
  const shown = query.trim() === "" ? [] : found;

  function choose(row: Customer) {
    setCustomer(row);
    setQuery("");
    setFound([]);
    setShares({});
    setInvoices([]);
    void fetch(`/api/v1/customers/${row.id}/open-invoices`)
      .then((response) => (response.ok ? response.json() : { data: [] }))
      .then((body: { data: Open[] }) => setInvoices(body.data ?? []))
      .catch(() => setInvoices([]));
  }

  const named = Object.entries(shares).filter(([, value]) => value.trim() !== "").map(([invoiceId, value]) => ({ invoiceId, amount: value.trim() }));

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!customer) return;
        void submit<{ id: string }>(
          { url: "/api/v1/customer-payments", body: { customerId: customer.id, businessDate: date, amount, method: account?.kind ?? "CASH", accountId: accountId || undefined, charge: charge.trim() === "" ? undefined : charge, allocations: named.length > 0 ? named : undefined } },
          { successMessage: "পেমেন্ট সংরক্ষিত হয়েছে। (Payment saved.)", onSuccess: () => { setAmount(""); setCharge(""); setShares({}); setCustomer(null); setInvoices([]); reset(); } },
        );
      }}
    >
      <section className="grid gap-2">
        <label className="grid gap-1 text-sm">
          Customer (name or phone)
          <Input value={customer ? customer.name : query} onChange={(event) => { setCustomer(null); setQuery(event.target.value); }} placeholder="Search customers" autoComplete="off" />
        </label>
        {customer ? <p className="text-sm text-muted">{customer.phone ?? ""} · owes {customer.outstanding}</p> : null}
        {shown.length > 0 && !customer ? (
          <ul className="max-h-56 overflow-auto rounded-md border border-border bg-surface text-sm" aria-label="Customers found">
            {shown.map((row) => (
              <li key={row.id}>
                <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted" onClick={() => choose(row)}>
                  <span>
                    {row.name} {row.phone ? `· ${row.phone}` : ""}
                  </span>
                  <span className="text-muted">owes {row.outstanding}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {customer ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1 text-sm">
              Date
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </label>
            <label className="grid gap-1 text-sm">
              Amount received
              <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
            </label>
            <label className="grid gap-1 text-sm">
              Came into
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={select}>
                {accounts.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            {account && account.kind !== "CASH" ? (
              <label className="grid gap-1 text-sm">
                Bank or mobile charge kept
                <Input inputMode="decimal" value={charge} onChange={(event) => setCharge(event.target.value)} placeholder="0.00" />
              </label>
            ) : null}
          </div>
          {invoices.length > 0 ? (
            <div className="grid gap-1 text-sm">
              <p className="font-medium">For these invoices (leave empty to settle the oldest first)</p>
              {invoices.map((invoice) => (
                <label key={invoice.id} className="flex items-center justify-between gap-3">
                  <span>
                    {invoice.number ?? "Invoice"} · {invoice.businessDate} · total {invoice.total} · owed {invoice.owed} ({invoice.status})
                  </span>
                  <input className="h-9 w-28 rounded-md border border-border bg-surface px-2 text-sm" inputMode="decimal" aria-label={`Amount for ${invoice.number ?? "invoice"}`} value={shares[invoice.id] ?? ""} onChange={(event) => setShares({ ...shares, [invoice.id]: event.target.value })} />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No invoice is open; an opening balance, if any, is settled first.</p>
          )}
        </>
      ) : null}
      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <div>
        <Button type="submit" loading={pending} disabled={!customer || accounts.length === 0}>
          Record receipt
        </Button>
      </div>
    </form>
  );
}
