"use client";

import { useState } from "react";

import type { AccountOption } from "@/components/purchasing/purchase-form";
import { Button } from "@/components/ui/button";
import { ChargeInput } from "@/components/treasury/charge-input";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

// The three things done with a vendor's money from the vendor's page: pay (from a chosen account, with the charge, for named bills or the
// oldest debt), pay ahead (an advance), and use the advance against bills. The server checks every amount; nothing is added up here.

type Bill = { id: string; number: string | null; businessDate: string; owed: string };

const select = "h-10 rounded-md border border-border bg-surface px-2";

function BillShares({ bills, shares, onChange }: { bills: Bill[]; shares: Record<string, string>; onChange: (shares: Record<string, string>) => void }) {
  if (bills.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-medium">For these bills (leave empty to settle the oldest first)</p>
      {bills.map((bill) => (
        <label key={bill.id} className="flex items-center justify-between gap-3">
          <span>
            {bill.number ?? "Bill"} · {bill.businessDate} · owed {bill.owed}
          </span>
          <input
            className="h-9 w-28 rounded-md border border-border bg-surface px-2 text-sm"
            inputMode="decimal"
            aria-label={`Amount for ${bill.number ?? "bill"}`}
            value={shares[bill.id] ?? ""}
            onChange={(event) => onChange({ ...shares, [bill.id]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

const allocationsOf = (shares: Record<string, string>) => {
  const rows = Object.entries(shares)
    .filter(([, amount]) => amount.trim() !== "")
    .map(([billId, amount]) => ({ billId, amount: amount.trim() }));
  return rows.length > 0 ? rows : undefined;
};

export function VendorPayForm({ supplierId, accounts, bills, today }: { supplierId: string; accounts: AccountOption[]; bills: Bill[]; today: string }) {
  const { submit, pending, message, reset } = useSubmit();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [charge, setCharge] = useState("");
  const [chargeTyped, setChargeTyped] = useState(false);
  const [shares, setShares] = useState<Record<string, string>>({});
  const account = accounts.find((row) => row.id === accountId);

  return (
    <form
      className="grid gap-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit<{ id: string }>(
          {
            url: `/api/v1/suppliers/${supplierId}/payments`,
            body: { businessDate: date, amount, method: account?.kind ?? "CASH", accountId: accountId || undefined, charge: charge.trim() === "" ? undefined : charge, allocations: allocationsOf(shares) },
          },
          { successMessage: "পেমেন্ট সংরক্ষিত হয়েছে। (Payment saved.)", onSuccess: () => { setAmount(""); setCharge(""); setShares({}); reset(); } },
        );
      }}
    >
      <h3 className="font-medium">Pay the vendor</h3>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-sm">
          Date
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Amount
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Paid from
          <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setChargeTyped(false); setCharge(""); }} className={select}>
            {accounts.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        {account && account.kind !== "CASH" ? (
          <ChargeInput accountId={accountId} amount={amount} value={charge} typed={chargeTyped} onChange={(value, typed) => { setCharge(value); setChargeTyped(typed); }} />
        ) : null}
      </div>
      <BillShares bills={bills} shares={shares} onChange={setShares} />
      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <div>
        <Button type="submit" loading={pending} disabled={accounts.length === 0}>
          Record payment
        </Button>
      </div>
    </form>
  );
}

export function VendorAdvanceForm({ supplierId, accounts, today }: { supplierId: string; accounts: AccountOption[]; today: string }) {
  const { submit, pending, message, reset } = useSubmit();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const account = accounts.find((row) => row.id === accountId);

  return (
    <form
      className="grid gap-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit<{ id: string }>(
          { url: `/api/v1/suppliers/${supplierId}/advances`, body: { businessDate: date, amount, method: account?.kind ?? "CASH", accountId: accountId || undefined } },
          { successMessage: "অগ্রিম সংরক্ষিত হয়েছে। (Advance saved.)", onSuccess: () => { setAmount(""); reset(); } },
        );
      }}
    >
      <h3 className="font-medium">Pay ahead (advance)</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Date
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Amount
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Paid from
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={select}>
            {accounts.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <div>
        <Button type="submit" loading={pending} disabled={accounts.length === 0}>
          Record advance
        </Button>
      </div>
    </form>
  );
}

export function VendorApplyAdvanceForm({ supplierId, bills, held, today }: { supplierId: string; bills: Bill[]; held: string; today: string }) {
  const { submit, pending, message, reset } = useSubmit();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState<Record<string, string>>({});

  return (
    <form
      className="grid gap-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit<{ id: string }>(
          { url: `/api/v1/suppliers/${supplierId}/advances/apply`, body: { businessDate: date, amount, allocations: allocationsOf(shares) } },
          { successMessage: "অগ্রিম বিলে সমন্বয় হয়েছে। (Advance used.)", onSuccess: () => { setAmount(""); setShares({}); reset(); } },
        );
      }}
    >
      <h3 className="font-medium">Use the advance against bills</h3>
      <p className="text-sm text-muted">{held} is held with this vendor. No cash or bank account moves.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Date
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Amount
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
      </div>
      <BillShares bills={bills} shares={shares} onChange={setShares} />
      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <div>
        <Button type="submit" loading={pending}>
          Use advance
        </Button>
      </div>
    </form>
  );
}
