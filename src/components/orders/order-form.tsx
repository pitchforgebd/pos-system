"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

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
  const { t, taka } = useI18n();
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
      successMessage: quotation ? t("orders.savedQuotation") : t("orders.savedOrder"),
      onSuccess: async (data) => {
        if (thenConfirm) {
          await submit({ url: `/api/v1/orders/${data.id}/confirm`, body: {} }, { successMessage: t("orders.confirmed"), refresh: false });
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
          {t("orders.customerLabel")}
          <Input
            value={customer ? customer.name : customerQuery}
            onChange={(event) => {
              setCustomer(null);
              setCustomerQuery(event.target.value);
            }}
            placeholder={t("orders.customerSearch")}
            autoComplete="off"
          />
        </label>
        {customer ? <p className="text-sm text-muted">{t("orders.customerLine", { phone: customer.phone ?? "", owes: taka(customer.outstanding), advance: taka(customer.advance) })}</p> : null}
        {shownCustomers.length > 0 && !customer ? (
          <ul className="max-h-56 overflow-auto rounded-md border border-border bg-surface text-sm" role="listbox" aria-label={t("orders.customersFound")}>
            {shownCustomers.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted"
                  onClick={() => {
                    setCustomer(row);
                    setCustomerQuery("");
                    setCustomers([]);
                  }}
                >
                  <span>
                    {row.name} {row.phone ? `· ${row.phone}` : ""}
                  </span>
                  <span className="text-muted">{t("orders.owes", { amount: taka(row.outstanding) })}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-sm">
          {t("orders.date")}
          <Input type="date" value={values.businessDate} onChange={(event) => set("businessDate", event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          {t("orders.channel")}
          <select value={values.channel} onChange={(event) => set("channel", event.target.value)} className={select}>
            {(["PHONE", "FACEBOOK", "WEBSITE", "POS", "OTHER"] as const).map((channel) => (
              <option key={channel} value={channel}>
                {t(`orders.channel.${channel}` as const)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {t("orders.delivery")}
          <select value={values.deliveryMethod} onChange={(event) => set("deliveryMethod", event.target.value)} className={select}>
            <option value="PICKUP">{t("orders.delivery.PICKUP")}</option>
            <option value="OWN_VEHICLE">{t("orders.delivery.OWN_VEHICLE")}</option>
            <option value="COURIER">{t("orders.delivery.COURIER")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {t("orders.externalRef")}
          <Input value={values.externalRef} onChange={(event) => set("externalRef", event.target.value)} maxLength={64} />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          {t("orders.address")}
          <Input value={values.shippingAddress} onChange={(event) => set("shippingAddress", event.target.value)} maxLength={255} />
        </label>
        <label className="grid gap-1 text-sm">
          {t("orders.expectedOn")}
          <Input type="date" value={values.expectedDate} onChange={(event) => set("expectedDate", event.target.value)} />
        </label>
        {quotation ? (
          <label className="grid gap-1 text-sm">
            {t("orders.validUntil")}
            <Input type="date" value={values.validUntil} onChange={(event) => set("validUntil", event.target.value)} />
          </label>
        ) : null}
        {canChooseLevel ? (
          <label className="grid gap-1 text-sm">
            {t("orders.priceLevel")}
            <select value={values.level} onChange={(event) => set("level", event.target.value)} className={select}>
              <option value="">{t("orders.ownLevel")}</option>
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
          {t("orders.addProduct")}
          <Input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder={t("orders.productSearch")} autoComplete="off" />
        </label>
        {shownHits.length > 0 ? (
          <ul className="max-h-64 overflow-auto rounded-md border border-border bg-surface text-sm" role="listbox" aria-label={t("orders.productsFound")}>
            {shownHits.map((hit) => (
              <li key={hit.id}>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted" onClick={() => addProduct(hit)}>
                  <span>
                    {hit.sku} · {hit.name}
                  </span>
                  <span className="text-muted">
                    {taka(hit.price)} ({hit.levelName}){hit.available !== null ? ` · ${t("orders.availableShort", { n: hit.available })}` : ""}
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
            <caption className="sr-only">{t("orders.linesCaption")}</caption>
            <thead className="text-left text-muted">
              <tr>
                <th className="p-1">{t("orders.product")}</th>
                <th className="p-1">{t("orders.price")}</th>
                <th className="p-1">{t("orders.quantity")}</th>
                <th className="p-1">{t("orders.discount")}</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key}>
                  <td className="p-1">
                    {line.label}
                    {line.available !== null ? <span className="ml-2 text-muted">({t("orders.availableShort", { n: line.available })})</span> : null}
                  </td>
                  <td className="p-1 tabular-nums">{taka(line.price)}</td>
                  <td className="p-1">
                    <input className={`${cell} w-24`} inputMode="decimal" aria-label={t("orders.quantity")} value={line.quantity} onChange={(event) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, quantity: event.target.value } : row)))} />
                  </td>
                  <td className="p-1">
                    <input className={`${cell} w-24`} inputMode="decimal" aria-label={t("orders.lineDiscount")} value={line.discount} onChange={(event) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, discount: event.target.value } : row)))} />
                  </td>
                  <td className="p-1">
                    <Button variant="ghost" size="sm" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} aria-label={t("orders.removeLine", { item: line.label })}>
                      {t("orders.remove")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">{t("orders.firstLine")}</p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          {t("orders.wholeDiscount")}
          <Input inputMode="decimal" value={values.headerDiscount} onChange={(event) => set("headerDiscount", event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          {t("orders.charges")}
          <Input inputMode="decimal" value={values.chargesTotal} onChange={(event) => set("chargesTotal", event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          {t("orders.note")}
          <Input value={values.note} onChange={(event) => set("note", event.target.value)} maxLength={500} />
        </label>
      </div>

      {message ? (
        <p className="text-sm text-error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={pending} disabled={!ready} onClick={() => save(false)}>
          {initial?.id ? t("orders.saveChanges") : quotation ? t("orders.saveQuotation") : t("orders.saveDraft")}
        </Button>
        {!quotation && !initial?.id ? (
          <Button loading={pending} disabled={!ready} onClick={() => save(true)}>
            {t("orders.saveConfirm")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
