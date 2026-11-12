"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

// A courier's settlement (#27): tick the parcels, see the cash collected, the charges and what should come, say what came and where it went.
// If what came is not what should have, give the reason (only a user who may approve differences can post it).

type Parcel = { id: string; number: string | null; status: "DELIVERED" | "RETURNED"; trackingCode: string | null; customerName: string; cod: string; delivery: string; condition: string; amount: string; since: string | null; daysWaiting: number };
type Account = { id: string; label: string };

const cents = (value: string) => Math.round((Number.parseFloat(value) || 0) * 100);
const text = (value: number) => (value / 100).toFixed(2);

export function SettleForm({ courierId, parcels, accounts, today, canApproveDifference }: { courierId: string; parcels: Parcel[]; accounts: Account[]; today: string; canApproveDifference: boolean }) {
  const { submit, pending, message, reset } = useSubmit();
  const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(parcels.map((parcel) => [parcel.id, true])));
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [received, setReceived] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const chosen = parcels.filter((parcel) => ticked[parcel.id]);
  const gross = chosen.reduce((sum, parcel) => sum + cents(parcel.cod), 0);
  const delivery = chosen.reduce((sum, parcel) => sum + cents(parcel.delivery), 0);
  const condition = chosen.reduce((sum, parcel) => sum + cents(parcel.condition), 0);
  const expected = chosen.reduce((sum, parcel) => sum + cents(parcel.amount), 0);
  const net = received ?? text(expected);
  const difference = cents(net) - expected;

  if (parcels.length === 0) {
    return <p className="text-sm text-muted">Nothing waits to be settled for this courier: no delivered parcel, and none that came back, is outstanding.</p>;
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit<{ id: string }>(
          { url: `/api/v1/couriers/${courierId}/settle`, body: { shipmentIds: chosen.map((parcel) => parcel.id), businessDate: date, netReceived: net, accountId: accountId || undefined, differenceReason: difference !== 0 && reason.trim() !== "" ? reason.trim() : undefined } },
          { successMessage: "সেটেলমেন্ট সংরক্ষিত হয়েছে। (Settlement saved.)", goTo: "/couriers", onSuccess: () => reset() },
        );
      }}
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Parcels waiting to be settled</caption>
          <thead className="text-left text-muted">
            <tr>
              <th className="p-2" />
              <th className="p-2">Shipment</th>
              <th className="p-2">Customer</th>
              <th className="p-2 text-right">Cash collected</th>
              <th className="p-2 text-right">Delivery</th>
              <th className="p-2 text-right">Condition</th>
              <th className="p-2 text-right">Settles</th>
              <th className="p-2">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {parcels.map((parcel) => (
              <tr key={parcel.id}>
                <td className="p-2">
                  <input type="checkbox" aria-label={`Settle ${parcel.number ?? "parcel"}`} checked={Boolean(ticked[parcel.id])} onChange={(event) => setTicked({ ...ticked, [parcel.id]: event.target.checked })} />
                </td>
                <td className="p-2">
                  {parcel.number ?? "Shipment"}
                  {parcel.status === "RETURNED" ? <span className="ml-2 text-xs text-error">came back</span> : null}
                  {parcel.trackingCode ? <span className="block text-xs text-muted">{parcel.trackingCode}</span> : null}
                </td>
                <td className="p-2">{parcel.customerName}</td>
                <td className="p-2 text-right tabular-nums">{parcel.cod}</td>
                <td className="p-2 text-right tabular-nums">{parcel.delivery}</td>
                <td className="p-2 text-right tabular-nums">{parcel.condition}</td>
                <td className="p-2 text-right tabular-nums">{parcel.amount}</td>
                <td className={`p-2 ${parcel.daysWaiting > 7 ? "text-error" : ""}`}>{parcel.since ? `${parcel.daysWaiting} d` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-live="polite">
        <dt>Cash collected by the courier</dt>
        <dd className="text-right tabular-nums">{text(gross)}</dd>
        <dt>Delivery charges kept</dt>
        <dd className="text-right tabular-nums">{text(delivery)}</dd>
        <dt>Condition charges kept</dt>
        <dd className="text-right tabular-nums">{text(condition)}</dd>
        <dt className="font-medium">What should come</dt>
        <dd className="text-right font-medium tabular-nums">{text(expected)}</dd>
      </dl>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-sm">
          Date
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          What came
          <Input inputMode="decimal" value={net} onChange={(event) => setReceived(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Came into
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="h-10 rounded-md border border-border bg-surface px-2">
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
        </label>
        {difference !== 0 ? (
          <label className="grid gap-1 text-sm">
            Why it differs ({difference > 0 ? "over" : "short"} {text(Math.abs(difference))})
            <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} required />
          </label>
        ) : null}
      </div>
      {difference !== 0 && !canApproveDifference ? <p className="text-sm text-error">A difference needs the owner&apos;s approval: ask a user who may approve it.</p> : null}
      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <div>
        <Button type="submit" loading={pending} disabled={chosen.length === 0 || (difference !== 0 && !canApproveDifference)}>
          Record settlement
        </Button>
      </div>
    </form>
  );
}
