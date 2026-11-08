"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Option = { id: string; label: string };

export function QuotationForm({ customers, products }: { customers: Option[]; products: Option[] }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const productId = String(form.get("productId") || "");
        void submit({
          url: "/api/v1/quotations",
          body: {
            customerId: form.get("customerId"),
            businessDate: form.get("businessDate"),
            note: String(form.get("note") || "") || null,
            ...(productId
              ? { lines: [{ productId, quantity: form.get("quantity"), unitPrice: form.get("unitPrice") }] }
              : {}),
          },
        });
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
      <Input name="businessDate" type="date" required aria-label="Date" />
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
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({ url: "/api/v1/requisitions", body: { businessDate: form.get("businessDate"), note: form.get("note") } });
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Date" />
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
  const { submit, pending, message } = useSubmit();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ url: `/api/v1/quotations/${id}/convert`, body: {} });
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
  const { submit, pending, message } = useSubmit();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ url, body: {} });
      }}
    >
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        {label}
      </Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}
