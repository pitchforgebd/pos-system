"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

// The order form (P06): who, how it reaches them, and the lines. Prices come from the server (the customer's price level and the quantity):
// the form shows what the search found, the order page shows what was worked out. A quotation is the same form with a valid-until date.

type Customer = { id: string; name: string; phone: string | null; outstanding: string; advance: string; customerTypeId: string | null };
type Hit = { id: string; sku: string; name: string; price: string; levelName: string; available: string | null; isService: boolean };
type Line = { key: number; productId: string; label: string; price: string; available: string | null; quantity: string; discount: string };

const select = "h-10 rounded-md border border-border bg-surface px-2";
const cell = "h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-sm";
const opt = (value: string) => (value.trim() === "" ? undefined : value.trim());

export type OrderFormValues = {
  id?: string;
  customer: Customer | null;
  businessDate: string;
  channel: string;
  deliveryMethod: string;
  shippingAddress: string;
  externalRef: string;
  expectedDate: string;
  validUntil: string;
  note: string;
  headerDiscount: string;
  chargesTotal: string;
  level: string;
  lines: Array<{ productId: string; label: string; price: string; available: string | null; quantity: string; discount: string }>;
};

export function OrderForm({ today, quotation, levels, canChooseLevel, initial }: { today: string; quotation: boolean; levels: string[]; canChooseLevel: boolean; initial?: OrderFormValues }) {
  const { submit, pending, message } = useSubmit();
  const [customer, setCustomer] = useState<Customer | null>(initial?.customer ?? null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [lines, setLines] = useState<Line[]>((initial?.lines ?? []).map((line, key) => ({ ...line, key })));
  const [nextKey, setNextKey] = useState(lines.length);
  const [values, setValues] = useState({
    businessDate: initial?.businessDate ?? today,
    channel: initial?.channel ?? "PHONE",
    deliveryMethod: initial?.deliveryMethod ?? "PICKUP",
    shippingAddress: initial?.shippingAddress ?? "",
    externalRef: initial?.externalRef ?? "",
    expectedDate: initial?.expectedDate ?? "",
    validUntil: initial?.validUntil ?? "",
    note: initial?.note ?? "",
    headerDiscount: initial?.headerDiscount ?? "",
    chargesTotal: initial?.chargesTotal ?? "",
    level: initial?.level ?? "",
  });
  const set = (name: keyof typeof values, value: string) => setValues((current) => ({ ...current, [name]: value }));

  useEffect(() => {
    if (customerQuery.trim() === "") {
      return;
    }
    const handle = setTimeout(() => {
      void fetch(`/api/v1/search/customers?q=${encodeURIComponent(customerQuery.trim())}`)
        .then((response) => (response.ok ? response.json() : { data: [] }))
        .then((body: { data: Customer[] }) => setCustomers(body.data ?? []))
        .catch(() => setCustomers([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [customerQuery]);

  useEffect(() => {
    if (productQuery.trim() === "") {
      return;
    }
    const handle = setTimeout(() => {
      const level = values.level ? `&level=${encodeURIComponent(values.level)}` : "";
      const type = customer?.customerTypeId ? `&customerTypeId=${customer.customerTypeId}` : "";
      void fetch(`/api/v1/search/products?q=${encodeURIComponent(productQuery.trim())}${level}${type}`)
        .then((response) => (response.ok ? response.json() : { data: [] }))
        .then((body: { data: Hit[] }) => setHits(body.data ?? []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [productQuery, values.level, customer?.customerTypeId]);

  const shownCustomers = customerQuery.trim() === "" ? [] : customers;
  const shownHits = productQuery.trim() === "" ? [] : hits;

  function addProduct(hit: Hit) {
    setLines((current) => [...current, { key: nextKey, productId: hit.id, label: `${hit.sku} · ${hit.name}`, price: hit.price, available: hit.available, quantity: "1", discount: "" }]);
    setNextKey((n) => n + 1);
    setProductQuery("");
    setHits([]);
  }

  function payload() {
    return {
      customerId: customer?.id,
      businessDate: values.businessDate,
      channel: values.channel,
      deliveryMethod: values.deliveryMethod,
      shippingAddress: opt(values.shippingAddress),
      externalRef: opt(values.externalRef),
      expectedDate: opt(values.expectedDate),
      validUntil: quotation ? opt(values.validUntil) : undefined,
      note: opt(values.note),
      level: canChooseLevel ? opt(values.level) : undefined,
      headerDiscount: opt(values.headerDiscount),
      chargesTotal: opt(values.chargesTotal),
      lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, discountAmount: opt(line.discount) })),
    };
  }

  function save(thenConfirm: boolean) {
    const request = initial?.id
      ? { url: `/api/v1/orders/${initial.id}`, method: "PATCH" as const, body: payload() }
      : { url: quotation ? "/api/v1/quotations" : "/api/v1/orders", body: payload() };
    void submit<{ id: string }>(request, {
      successMessage: quotation ? "কোটেশন সংরক্ষিত হয়েছে। (Quotation saved.)" : "অর্ডার সংরক্ষিত হয়েছে। (Order saved.)",
      onSuccess: async (data) => {
        if (thenConfirm) {
          await submit({ url: `/api/v1/orders/${data.id}/confirm`, body: {} }, { successMessage: "অর্ডার নিশ্চিত হয়েছে। (Order confirmed.)", refresh: false });
        }
      },
      goTo: (data) => `/orders/${data.id}`,
    });
  }

  const ready = Boolean(customer) && lines.length > 0;

  return (
    <form className="grid gap-5" onSubmit={(event) => event.preventDefault()}>
      <section className="grid gap-2">
        <label className="grid gap-1 text-sm">
          Customer (name or phone)
          <Input value={customer ? customer.name : customerQuery} onChange={(event) => { setCustomer(null); setCustomerQuery(event.target.value); }} placeholder="Search customers" autoComplete="off" />
        </label>
        {customer ? (
          <p className="text-sm text-muted">
            {customer.phone ?? ""} · owes {customer.outstanding} · advance {customer.advance}
          </p>
        ) : null}
        {shownCustomers.length > 0 && !customer ? (
          <ul className="max-h-56 overflow-auto rounded-md border border-border bg-surface text-sm" role="listbox" aria-label="Customers found">
            {shownCustomers.map((row) => (
              <li key={row.id}>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted" onClick={() => { setCustomer(row); setCustomerQuery(""); setCustomers([]); }}>
                  <span>
                    {row.name} {row.phone ? `· ${row.phone}` : ""}
                  </span>
                  <span className="text-muted">owes {row.outstanding}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-sm">
          Date
          <Input type="date" value={values.businessDate} onChange={(event) => set("businessDate", event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Channel
          <select value={values.channel} onChange={(event) => set("channel", event.target.value)} className={select}>
            {["PHONE", "FACEBOOK", "WEBSITE", "POS", "OTHER"].map((channel) => (
              <option key={channel} value={channel}>
                {channel.charAt(0) + channel.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Delivery
          <select value={values.deliveryMethod} onChange={(event) => set("deliveryMethod", event.target.value)} className={select}>
            <option value="PICKUP">Customer picks up</option>
            <option value="OWN_VEHICLE">Own vehicle</option>
            <option value="COURIER">Courier</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Order ref. (Facebook, website…)
          <Input value={values.externalRef} onChange={(event) => set("externalRef", event.target.value)} maxLength={64} />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          Delivery address
          <Input value={values.shippingAddress} onChange={(event) => set("shippingAddress", event.target.value)} maxLength={255} />
        </label>
        <label className="grid gap-1 text-sm">
          Expected on
          <Input type="date" value={values.expectedDate} onChange={(event) => set("expectedDate", event.target.value)} />
        </label>
        {quotation ? (
          <label className="grid gap-1 text-sm">
            Valid until
            <Input type="date" value={values.validUntil} onChange={(event) => set("validUntil", event.target.value)} />
          </label>
        ) : null}
        {canChooseLevel ? (
          <label className="grid gap-1 text-sm">
            Price level
            <select value={values.level} onChange={(event) => set("level", event.target.value)} className={select}>
              <option value="">The customer&apos;s own</option>
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <section className="grid gap-2">
        <label className="grid gap-1 text-sm">
          Add a product (name, SKU or barcode)
          <Input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Search products" autoComplete="off" />
        </label>
        {shownHits.length > 0 ? (
          <ul className="max-h-64 overflow-auto rounded-md border border-border bg-surface text-sm" role="listbox" aria-label="Products found">
            {shownHits.map((hit) => (
              <li key={hit.id}>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted" onClick={() => addProduct(hit)}>
                  <span>
                    {hit.sku} · {hit.name}
                  </span>
                  <span className="text-muted">
                    {hit.price} ({hit.levelName}){hit.available !== null ? ` · ${hit.available} available` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {lines.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Order lines</caption>
            <thead className="text-left text-muted">
              <tr>
                <th className="p-1">Product</th>
                <th className="p-1">Price</th>
                <th className="p-1">Quantity</th>
                <th className="p-1">Discount</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key}>
                  <td className="p-1">
                    {line.label}
                    {line.available !== null ? <span className="ml-2 text-muted">({line.available} available)</span> : null}
                  </td>
                  <td className="p-1 tabular-nums">{line.price}</td>
                  <td className="p-1">
                    <input className={`${cell} w-24`} inputMode="decimal" aria-label="Quantity" value={line.quantity} onChange={(event) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, quantity: event.target.value } : row)))} />
                  </td>
                  <td className="p-1">
                    <input className={`${cell} w-24`} inputMode="decimal" aria-label="Line discount" value={line.discount} onChange={(event) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, discount: event.target.value } : row)))} />
                  </td>
                  <td className="p-1">
                    <Button variant="ghost" size="sm" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} aria-label={`Remove ${line.label}`}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">Search for a product to add the first line.</p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Discount on the whole order
          <Input inputMode="decimal" value={values.headerDiscount} onChange={(event) => set("headerDiscount", event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          Delivery and other charges
          <Input inputMode="decimal" value={values.chargesTotal} onChange={(event) => set("chargesTotal", event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          Note
          <Input value={values.note} onChange={(event) => set("note", event.target.value)} maxLength={500} />
        </label>
      </div>

      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={pending} disabled={!ready} onClick={() => save(false)}>
          {initial?.id ? "Save changes" : quotation ? "Save quotation" : "Save as draft"}
        </Button>
        {!quotation && !initial?.id ? (
          <Button loading={pending} disabled={!ready} onClick={() => save(true)}>
            Save and confirm (reserve the stock)
          </Button>
        ) : null}
      </div>
    </form>
  );
}
