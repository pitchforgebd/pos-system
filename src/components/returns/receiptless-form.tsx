"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

// A return with no invoice (N10). The product is found by the server's search; the refund price cannot be more than the current retail price;
// a second user (a manager) approves with their login and password; the money goes out of the chosen account.

type Hit = { id: string; sku: string; name: string; price: string };
type Account = { id: string; label: string; kind: "CASH" | "BANK" | "MOBILE" };
const select = "h-10 rounded-md border border-border bg-surface px-2";

export function ReceiptlessReturnForm({ accounts, today }: { accounts: Account[]; today: string }) {
  const { submit, pending, message, reset } = useSubmit();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [product, setProduct] = useState<Hit | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unitRefund, setUnitRefund] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const account = accounts.find((row) => row.id === accountId);

  useEffect(() => {
    if (query.trim() === "") {
      return;
    }
    const handle = setTimeout(() => {
      void fetch(`/api/v1/search/products?q=${encodeURIComponent(query.trim())}`)
        .then((response) => (response.ok ? response.json() : { data: [] }))
        .then((body: { data: Hit[] }) => setHits(body.data ?? []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);
  const shown = query.trim() === "" ? [] : hits;

  return (
    <form
      className="grid max-w-3xl gap-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!product) return;
        void submit<{ id: string }>(
          {
            url: "/api/v1/returns/without-invoice",
            body: { businessDate: date, reason, refundMethod: account?.kind ?? "CASH", refundAccountId: accountId || undefined, approver: { email, password }, lines: [{ productId: product.id, quantity, unitRefund: unitRefund.trim() === "" ? undefined : unitRefund }] },
          },
          { successMessage: "রিটার্ন সংরক্ষিত হয়েছে। (Return saved.)", onSuccess: () => { setProduct(null); setQuantity("1"); setUnitRefund(""); setReason(""); setPassword(""); reset(); } },
        );
      }}
    >
      <h2 className="font-medium">Return with no invoice</h2>
      <p className="text-sm text-muted">Only at the current retail price, with a second user&apos;s approval. If the customer has the invoice, return against it instead.</p>
      <label className="grid gap-1 text-sm">
        Product (name, SKU or barcode)
        <Input value={product ? `${product.sku} · ${product.name}` : query} onChange={(event) => { setProduct(null); setQuery(event.target.value); }} autoComplete="off" />
      </label>
      {shown.length > 0 && !product ? (
        <ul className="max-h-48 overflow-auto rounded-md border border-border bg-surface text-sm" aria-label="Products found">
          {shown.map((hit) => (
            <li key={hit.id}>
              <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted" onClick={() => { setProduct(hit); setQuery(""); setHits([]); setUnitRefund(hit.price); }}>
                <span>
                  {hit.sku} · {hit.name}
                </span>
                <span className="text-muted">retail {hit.price}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-sm">
          Date
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Quantity
          <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Refund price (each)
          <Input inputMode="decimal" value={unitRefund} onChange={(event) => setUnitRefund(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          Refunded from
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={select}>
            {accounts.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        Why is it coming back?
        <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} required />
      </label>
      <fieldset className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2">
        <legend className="px-1 text-sm font-medium">Approved by (another user)</legend>
        <label className="grid gap-1 text-sm">
          Their email
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" required />
        </label>
        <label className="grid gap-1 text-sm">
          Their password
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
        </label>
      </fieldset>
      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <div>
        <Button type="submit" loading={pending} disabled={!product || accounts.length === 0}>
          Post return
        </Button>
      </div>
    </form>
  );
}
