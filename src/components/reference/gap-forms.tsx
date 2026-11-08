"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormSubmit } from "@/lib/client/use-form-submit";

type Option = { id: string; label: string };

const selectClass = "h-10 rounded-md border border-border bg-surface px-3 text-sm";

export function SerialForm({ products }: { products: Option[] }) {
  const form = useFormSubmit("/api/v1/products/serials", (data) => ({ productId: data.get("productId"), serial: data.get("serial") }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="productId" required aria-label="Product" className={selectClass}>
        <option value="">Serial product</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>{product.label}</option>
        ))}
      </select>
      <Input name="serial" required placeholder="IMEI or serial" aria-label="IMEI or serial" />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>Save IMEI</Button>
    </form>
  );
}

export function ClaimForm({ products, customers }: { products: Option[]; customers: Option[] }) {
  const form = useFormSubmit("/api/v1/warranty-claims", (data) => ({
    productId: data.get("productId"),
    customerId: data.get("customerId"),
    serial: String(data.get("serial") || "") || undefined,
    note: data.get("note"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="productId" required aria-label="Product" className={selectClass}>
        <option value="">Warranty product</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>{product.label}</option>
        ))}
      </select>
      <select name="customerId" required aria-label="Customer" className={selectClass}>
        <option value="">Customer</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>{customer.label}</option>
        ))}
      </select>
      <Input name="serial" placeholder="IMEI, if any" aria-label="IMEI" />
      <Input name="note" required placeholder="Claim note" aria-label="Note" />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>File claim</Button>
    </form>
  );
}

export function CloseClaim({ id }: { id: string }) {
  const form = useFormSubmit(`/api/v1/warranty-claims/${id}/close`, () => ({}));
  const message = form.message;
  return (
    <form onSubmit={form.onSubmit}>
      <Button type="submit" variant="secondary" size="sm" loading={form.pending}>Close</Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}

export function CourierForm() {
  const form = useFormSubmit("/api/v1/couriers", (data) => ({
    name: data.get("name"),
    phone: String(data.get("phone") || "") || undefined,
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Input name="name" required placeholder="Courier name" aria-label="Courier name" />
      <Input name="phone" placeholder="Phone" aria-label="Phone" />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>Save courier</Button>
    </form>
  );
}

export function ShipmentForm({ couriers, customers }: { couriers: Option[]; customers: Option[] }) {
  const form = useFormSubmit("/api/v1/shipments", (data) => ({
    courierId: data.get("courierId"),
    customerId: String(data.get("customerId") || "") || undefined,
    reference: String(data.get("reference") || "") || undefined,
    trackingCode: String(data.get("trackingCode") || "") || undefined,
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="courierId" required aria-label="Courier" className={selectClass}>
        <option value="">Courier</option>
        {couriers.map((courier) => (
          <option key={courier.id} value={courier.id}>{courier.label}</option>
        ))}
      </select>
      <select name="customerId" aria-label="Customer" className={selectClass}>
        <option value="">Customer, optional</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>{customer.label}</option>
        ))}
      </select>
      <Input name="reference" placeholder="Reference" aria-label="Reference" />
      <Input name="trackingCode" placeholder="Tracking code" aria-label="Tracking code" />
      <p className="text-sm text-muted">The shipment is stored here. No courier service is called.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>Save shipment</Button>
    </form>
  );
}

export function DirectReturnForm({ products }: { products: Option[] }) {
  const form = useFormSubmit("/api/v1/direct-returns", (data) => ({
    productId: data.get("productId"),
    quantity: data.get("quantity"),
    refundAmount: data.get("refundAmount"),
    method: data.get("method"),
    businessDate: data.get("businessDate"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="productId" required aria-label="Product" className={selectClass}>
        <option value="">Product</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>{product.label}</option>
        ))}
      </select>
      <Input name="quantity" required placeholder="Quantity" aria-label="Quantity" />
      <Input name="refundAmount" required placeholder="Refund" aria-label="Refund" />
      <select name="method" required aria-label="Refund method" className={selectClass} defaultValue="CASH">
        <option value="CASH">Cash</option>
        <option value="BANK">Bank</option>
      </select>
      <Input name="businessDate" type="date" required aria-label="Date" />
      <p className="text-sm text-muted">Stock comes back at the average stock-in cost. Cash or bank is refunded. There is no separate return rate.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>Post direct return</Button>
    </form>
  );
}

export function DealerForm({ customers }: { customers: Option[] }) {
  const form = useFormSubmit("/api/v1/customers/dealers", (data) => ({ customerId: data.get("customerId") }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="customerId" required aria-label="Customer" className={selectClass}>
        <option value="">Customer</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>{customer.label}</option>
        ))}
      </select>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>Mark as dealer</Button>
    </form>
  );
}

export function RedeemForm({ customers }: { customers: Option[] }) {
  const form = useFormSubmit("/api/v1/loyalty/redeem", (data) => ({
    customerId: data.get("customerId"),
    points: data.get("points"),
    businessDate: data.get("businessDate"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="customerId" required aria-label="Customer" className={selectClass}>
        <option value="">Customer</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>{customer.label}</option>
        ))}
      </select>
      <Input name="points" required placeholder="Points" aria-label="Points" />
      <Input name="businessDate" type="date" required aria-label="Date" />
      <p className="text-sm text-muted">Taka per point comes from shop settings. Points are not redeemed when that rate is blank.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>Redeem points</Button>
    </form>
  );
}
