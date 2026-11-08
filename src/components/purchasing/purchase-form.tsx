"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Option = { id: string; label: string };

export function PurchaseForm({ suppliers, products }: { suppliers: Option[]; products: Option[] }) {
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const paymentAmount = String(form.get("paymentAmount") || "");
        void submit<{ id: string }>(
          {
            url: "/api/v1/purchases",
            body: {
              supplierId: form.get("supplierId"),
              businessDate: form.get("businessDate"),
              paymentAmount: paymentAmount || undefined,
              paymentMethod: paymentAmount ? form.get("paymentMethod") : undefined,
              lines: [
                {
                  productId: form.get("productId"),
                  quantity: form.get("quantity"),
                  unitCost: form.get("unitCost"),
                  lot: String(form.get("lot") || "") || undefined,
                  manufacturedOn: String(form.get("manufacturedOn") || "") || undefined,
                  expiresOn: String(form.get("expiresOn") || "") || undefined,
                },
              ],
            },
          },
          { successMessage: "ক্রয় সংরক্ষিত হয়েছে। (Purchase saved.)", goTo: (data) => `/purchases/${data.id}` },
        );
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
      <Input name="businessDate" type="date" required aria-label="Date" />
      <Input name="quantity" required placeholder="Quantity" aria-label="Quantity" />
      <Input name="unitCost" required placeholder="Unit cost" aria-label="Unit cost" />
      <Input name="lot" placeholder="Lot (required for expiry-tracked products)" aria-label="Lot" />
      <Input name="manufacturedOn" type="date" aria-label="Manufactured on" />
      <Input name="expiresOn" type="date" aria-label="Expiry date" />
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
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit(
          {
            url: `/api/v1/suppliers/${form.get("supplierId")}/payments`,
            body: { businessDate: form.get("businessDate"), amount: form.get("amount"), method: form.get("method") },
          },
          { successMessage: "পেমেন্ট সংরক্ষিত হয়েছে। (Payment saved.)" },
        );
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
      <Input name="businessDate" type="date" required aria-label="Date" />
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
