"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Option = { id: string; label: string };

export function PurchaseForm({ suppliers, products }: { suppliers: Option[]; products: Option[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const paymentAmount = String(form.get("paymentAmount") || "");
        setPending(true);
        setMessage("");
        void fetch("/api/v1/purchases", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            supplierId: form.get("supplierId"),
            occurredOn: form.get("occurredOn"),
            paymentAmount: paymentAmount || undefined,
            paymentMethod: paymentAmount ? form.get("paymentMethod") : undefined,
            lines: [
              {
                productId: form.get("productId"),
                quantity: form.get("quantity"),
                unitCost: form.get("unitCost"),
              },
            ],
          }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { data?: { id?: string }; error?: { message?: string } };
            if (!response.ok || !body.data?.id) {
              setMessage(body.error?.message ?? "The purchase was not saved.");
              return;
            }
            window.location.replace(`/purchases/${body.data.id}`);
          })
          .finally(() => setPending(false));
      }}
    >
      <label className="grid gap-1 text-sm">
        Supplier
        <select name="supplierId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Product
        <select name="productId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="occurredOn" type="date" required aria-label="Date" />
      <Input name="quantity" required placeholder="Quantity" aria-label="Quantity" />
      <Input name="unitCost" required placeholder="Unit cost" aria-label="Unit cost" />
      <Input name="paymentAmount" placeholder="Payment amount" aria-label="Payment amount" defaultValue="0.00" />
      <label className="grid gap-1 text-sm">
        Payment method
        <select name="paymentMethod" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="CASH">
          <option value="CASH">Cash</option>
          <option value="BANK">Bank</option>
        </select>
      </label>
      <p className="text-sm text-muted">Discount, VAT, and charges stay zero until those formulas are defined.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={suppliers.length === 0 || products.length === 0}>
        Post purchase
      </Button>
    </form>
  );
}

export function SupplierPaymentForm({ suppliers }: { suppliers: Option[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void fetch(`/api/v1/suppliers/${form.get("supplierId")}/payments`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            occurredOn: form.get("occurredOn"),
            amount: form.get("amount"),
            method: form.get("method"),
          }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { error?: { message?: string } };
            setMessage(response.ok ? "Saved." : (body.error?.message ?? "The payment was not saved."));
          })
          .finally(() => setPending(false));
      }}
    >
      <label className="grid gap-1 text-sm">
        Supplier
        <select name="supplierId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="occurredOn" type="date" required aria-label="Date" />
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <label className="grid gap-1 text-sm">
        Method
        <select name="method" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="CASH">
          <option value="CASH">Cash</option>
          <option value="BANK">Bank</option>
        </select>
      </label>
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={suppliers.length === 0}>
        Record payment
      </Button>
    </form>
  );
}
