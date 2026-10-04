"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Line = { documentId: string; itemId: string; label: string };

export function ReturnForm({ lines, kind }: { lines: Line[]; kind: "sale" | "purchase" }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const visible = lines.filter((line) => line.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const [documentId, itemId] = String(form.get("line") || "").split("|");
        const method = String(form.get("refundMethod") || "");
        if (!documentId || !itemId) {
          setMessage("Choose a line.");
          return;
        }
        setPending(true);
        setMessage("");
        const path = kind === "sale" ? `/api/v1/sales/${documentId}/return` : `/api/v1/purchases/${documentId}/return`;
        const line = kind === "sale"
          ? { saleItemId: itemId, quantity: form.get("quantity") }
          : { purchaseItemId: itemId, quantity: form.get("quantity") };
        void fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            occurredOn: form.get("occurredOn"),
            refundMethod: kind === "purchase" && method ? method : undefined,
            lines: [line],
          }),
        })
          .then(async (response) => {
            const payload = (await response.json()) as { error?: { message?: string } };
            if (!response.ok) {
              setMessage(payload.error?.message ?? "The return was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
      }}
    >
      <label className="grid gap-1 text-sm">
        Search
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Invoice, SKU, or product" aria-label="Search a returnable product" className="h-10 rounded-md border border-border px-3" />
      </label>
      <label className="grid gap-1 text-sm">
        Returnable product
        <select name="line" required className="h-10 rounded-md border border-border bg-surface px-2">
          {visible.map((line) => (
            <option key={line.itemId} value={`${line.documentId}|${line.itemId}`}>
              {line.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="occurredOn" type="date" required aria-label="Date" />
      <Input name="quantity" required placeholder="Quantity" aria-label="Quantity" />
      {kind === "purchase" ? (
        <label className="grid gap-1 text-sm">
          Refund method
          <select name="refundMethod" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="">
            <option value="">No cash refund</option>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank</option>
          </select>
        </label>
      ) : null}
      <p className="text-sm text-muted">The return cannot exceed the quantity still eligible. A second return cannot use those units again.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={visible.length === 0}>
        Post return
      </Button>
    </form>
  );
}
