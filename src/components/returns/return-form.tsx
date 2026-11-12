"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Line = { documentId: string; itemId: string; label: string };

export function ReturnForm({ lines, kind }: { lines: Line[]; kind: "sale" | "purchase" }) {
  const [localMessage, setLocalMessage] = useState("");
  const { submit, pending, message: serverMessage } = useSubmit();
  const message = localMessage || serverMessage;
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
          setLocalMessage("Choose a line.");
          return;
        }
        setLocalMessage("");
        const path = kind === "sale" ? `/api/v1/sales/${documentId}/return` : `/api/v1/purchases/${documentId}/return`;
        const line = kind === "sale"
          ? { saleItemId: itemId, quantity: form.get("quantity") }
          : { purchaseItemId: itemId, quantity: form.get("quantity") };
        void submit(
          {
            url: path,
            body: {
              businessDate: form.get("businessDate"),
              refundMethod: method ? method : undefined,
              lines: [line],
            },
          },
          { successMessage: "রিটার্ন সংরক্ষিত হয়েছে। (Return saved.)" },
        );
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
      <Input name="businessDate" type="date" required aria-label="Date" />
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
      ) : (
        <label className="grid gap-1 text-sm">
          Refund
          <select name="refundMethod" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="">
            <option value="">The way the customer paid</option>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank</option>
            <option value="ADVANCE">To the customer&apos;s advance</option>
            <option value="AR_ONLY">Leave as credit on their account</option>
          </select>
        </label>
      )}
      <p className="text-sm text-muted">The return cannot exceed the quantity still eligible. A second return cannot use those units again.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={visible.length === 0}>
        Post return
      </Button>
    </form>
  );
}
