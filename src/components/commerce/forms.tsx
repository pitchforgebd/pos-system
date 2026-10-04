"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Option = { id: string; label: string };

function postJson(url: string, body?: unknown, idempotent = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idempotent) {
    headers["idempotency-key"] = crypto.randomUUID();
  }
  return fetch(url, { method: "POST", headers, body: body ? JSON.stringify(body) : "{}" }).then(async (response) => {
    const payload = (await response.json()) as { error?: { message?: string } };
    return { ok: response.ok, message: payload.error?.message ?? "" };
  });
}

export function QuotationForm({ customers, products }: { customers: Option[]; products: Option[] }) {
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
        const productId = String(form.get("productId") || "");
        void postJson(
          "/api/v1/quotations",
          {
            customerId: form.get("customerId"),
            occurredOn: form.get("occurredOn"),
            note: String(form.get("note") || "") || null,
            ...(productId
              ? { lines: [{ productId, quantity: form.get("quantity"), unitPrice: form.get("unitPrice") }] }
              : {}),
          },
          true,
        )
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The quotation was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
      }}
    >
      <select name="customerId" required aria-label="Customer" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">Customer</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.label}
          </option>
        ))}
      </select>
      <Input name="occurredOn" type="date" required aria-label="Date" />
      <select name="productId" aria-label="Product" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">Product line, optional</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.label}
          </option>
        ))}
      </select>
      <Input name="quantity" placeholder="Quantity" aria-label="Quantity" />
      <Input name="unitPrice" placeholder="Unit price" aria-label="Unit price" />
      <Input name="note" placeholder="Note" aria-label="Note" />
      <p className="text-sm text-muted">A product line can be converted into a due sale at the quoted price.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save quotation
      </Button>
    </form>
  );
}

export function RequisitionForm() {
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
        void postJson("/api/v1/requisitions", { occurredOn: form.get("occurredOn"), note: form.get("note") }, true)
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The requisition was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
      }}
    >
      <Input name="occurredOn" type="date" required aria-label="Date" />
      <Input name="note" required placeholder="Note" aria-label="Note" />
      <p className="text-sm text-muted">The request uses the signed-in branch. Approval does not move stock.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save request
      </Button>
    </form>
  );
}

export function ConvertQuotation({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setMessage("");
        void postJson(`/api/v1/quotations/${id}/convert`, undefined, true).then((result) => {
          if (!result.ok) {
            setMessage(result.message || "The quotation was not converted.");
            setPending(false);
            return;
          }
          window.location.reload();
        });
      }}
    >
      <Button type="submit" size="sm" loading={pending}>
        Convert to sale
      </Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}

export function StatusAction({ url, label }: { url: string; label: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setMessage("");
        void postJson(url)
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The status was not changed.");
              setPending(false);
              return;
            }
            window.location.reload();
          });
      }}
    >
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        {label}
      </Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}
