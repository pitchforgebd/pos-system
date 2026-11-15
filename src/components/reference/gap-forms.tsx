"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormSubmit } from "@/lib/client/use-form-submit";
import { useI18n } from "@/lib/i18n/provider";

type Option = { id: string; label: string };

const selectClass = "h-10 rounded-md border border-border bg-surface px-3 text-sm";

export function SerialForm({ products }: { products: Option[] }) {
  const { ph } = useI18n();
  const form = useFormSubmit("/api/v1/products/serials", (data) => ({ productId: data.get("productId"), serial: data.get("serial") }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="productId" required aria-label={ph("Product")} className={selectClass}>
        <option value="">{ph("Serial product")}</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>{product.label}</option>
        ))}
      </select>
      <Input name="serial" required placeholder={ph("IMEI or serial")} aria-label={ph("IMEI or serial")} />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>{ph("Save IMEI")}</Button>
    </form>
  );
}

export function ClaimForm({ products, customers }: { products: Option[]; customers: Option[] }) {
  const { ph } = useI18n();
  const form = useFormSubmit("/api/v1/warranty-claims", (data) => ({
    productId: data.get("productId"),
    customerId: data.get("customerId"),
    serial: String(data.get("serial") || "") || undefined,
    note: data.get("note"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="productId" required aria-label={ph("Product")} className={selectClass}>
        <option value="">{ph("Warranty product")}</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>{product.label}</option>
        ))}
      </select>
      <select name="customerId" required aria-label={ph("Customer")} className={selectClass}>
        <option value="">{ph("Customer")}</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>{customer.label}</option>
        ))}
      </select>
      <Input name="serial" placeholder={ph("IMEI, if any")} aria-label={ph("IMEI")} />
      <Input name="note" required placeholder={ph("Claim note")} aria-label={ph("Note")} />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>{ph("File claim")}</Button>
    </form>
  );
}

export function CloseClaim({ id }: { id: string }) {
  const { ph } = useI18n();
  const form = useFormSubmit(`/api/v1/warranty-claims/${id}/close`, () => ({}));
  const message = form.message;
  return (
    <form onSubmit={form.onSubmit}>
      <Button type="submit" variant="secondary" size="sm" loading={form.pending}>{ph("Close")}</Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}

export function DealerForm({ customers }: { customers: Option[] }) {
  const { ph } = useI18n();
  const form = useFormSubmit("/api/v1/customers/dealers", (data) => ({ customerId: data.get("customerId") }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="customerId" required aria-label={ph("Customer")} className={selectClass}>
        <option value="">{ph("Customer")}</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>{customer.label}</option>
        ))}
      </select>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>{ph("Mark as dealer")}</Button>
    </form>
  );
}

export function RedeemForm({ customers }: { customers: Option[] }) {
  const { ph } = useI18n();
  const form = useFormSubmit("/api/v1/loyalty/redeem", (data) => ({
    customerId: data.get("customerId"),
    points: data.get("points"),
    businessDate: data.get("businessDate"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="customerId" required aria-label={ph("Customer")} className={selectClass}>
        <option value="">{ph("Customer")}</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>{customer.label}</option>
        ))}
      </select>
      <Input name="points" required placeholder={ph("Points")} aria-label={ph("Points")} />
      <Input name="businessDate" type="date" required aria-label={ph("Date")} />
      <p className="text-sm text-muted">{ph("Taka per point comes from shop settings. Points are not redeemed when that rate is blank.")}</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>{ph("Redeem points")}</Button>
    </form>
  );
}
