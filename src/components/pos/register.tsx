"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ChargeInput } from "@/components/treasury/charge-input";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

// The register (P06 task 5). Products come from the server's search (never a preloaded list), the price comes from the customer's level and
// the quantity, and every figure shown is the server's own preview: the register adds up nothing but what is paid and what is left.
// F2 search, F4 customer, F6 hold, F9 payment, F10 complete.

export type RegisterAccount = { id: string; label: string; kind: "CASH" | "BANK" | "MOBILE" };
type Customer = { id: string; name: string; phone: string | null; outstanding: string; advance: string; customerTypeId: string | null };
type Hit = { id: string; sku: string; name: string; price: string; levelName: string; available: string | null; isService: boolean; trackSerial: boolean; matchedVariantId: string | null; hasImage: boolean };
type Line = { key: number; productId: string; variantId: string | null; label: string; quantity: string; discount: string; serial: string; available: string | null; trackSerial: boolean };
type Tender = { key: number; source: string; amount: string; charge: string; chargeTyped?: boolean };
type Preview = { gross: string; discount: string; vat: string; charges: string; total: string; lines: Array<{ productId: string; unitPrice: string; discount: string; vat: string; payable: string }> };

export type RegisterInitial = { ticketId: string; customer: { id: string; name: string; phone: string | null } | null; lines: Array<{ productId: string; variantId: string | null; label: string; quantity: string }>; warnings: string[] } | null;

const select = "h-10 rounded-md border border-border bg-surface px-2";
const cell = "h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-sm";
const opt = (value: string) => (value.trim() === "" ? undefined : value.trim());
const cents = (value: string) => Math.round((Number.parseFloat(value) || 0) * 100);
const text = (value: number) => (value / 100).toFixed(2);

export function Register({ accounts, categories, levels, canLevel, canDiscount, today, branchName, initial }: { accounts: RegisterAccount[]; categories: Array<{ id: string; name: string }>; levels: string[]; canLevel: boolean; canDiscount: boolean; today: string; branchName: string; initial: RegisterInitial }) {
  const { submit, pending, message } = useSubmit();
  const { submit: ask } = useSubmit();
  const { t, taka } = useI18n();
  const money = (value?: string | null) => (value ? taka(value) : "—");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(initial?.customer ? { ...initial.customer, outstanding: "0.00", advance: "0.00", customerTypeId: null } : null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lines, setLines] = useState<Line[]>((initial?.lines ?? []).map((line, key) => ({ key, productId: line.productId, variantId: line.variantId, label: line.label, quantity: line.quantity, discount: "", serial: "", available: null, trackSerial: false })));
  const [nextKey, setNextKey] = useState(lines.length + 1);
  const [level, setLevel] = useState("");
  const [headerDiscount, setHeaderDiscount] = useState("");
  const [charges, setCharges] = useState("");
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [takePreviousDue, setTakePreviousDue] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState(initial?.warnings.join(" · ") ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const payRef = useRef<HTMLInputElement>(null);

  // product search (server, 20 rows): by name, SKU or barcode, or a category
  useEffect(() => {
    if (query.trim() === "" && categoryId === "") {
      return;
    }
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim() });
      if (categoryId) params.set("categoryId", categoryId);
      if (level) params.set("level", level);
      if (customer?.customerTypeId) params.set("customerTypeId", customer.customerTypeId);
      void fetch(`/api/v1/search/products?${params.toString()}`)
        .then((response) => (response.ok ? response.json() : { data: [] }))
        .then((body: { data: Hit[] }) => setHits(body.data ?? []))
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, categoryId, level, customer?.customerTypeId]);
  const shownHits = query.trim() === "" && categoryId === "" ? [] : hits;

  useEffect(() => {
    if (customerQuery.trim() === "") {
      return;
    }
    const handle = setTimeout(() => {
      void fetch(`/api/v1/search/customers?q=${encodeURIComponent(customerQuery.trim())}`)
        .then((response) => (response.ok ? response.json() : { data: [] }))
        .then((body: { data: Customer[] }) => setCustomers(body.data ?? []))
        .catch(() => setCustomers([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [customerQuery]);
  const shownCustomers = customerQuery.trim() === "" ? [] : customers;

  const sale = useMemo(
    () => ({
      customerId: customer?.id,
      level: canLevel ? opt(level) : undefined,
      headerDiscount: canDiscount ? opt(headerDiscount) : undefined,
      chargesTotal: opt(charges),
      lines: lines.map((line) => ({ productId: line.productId, variantId: line.variantId ?? undefined, quantity: line.quantity, discountAmount: canDiscount ? opt(line.discount) : undefined, serial: opt(line.serial) })),
    }),
    [customer?.id, level, headerDiscount, charges, lines, canLevel, canDiscount],
  );

  // what the sale comes to, as the server works it out
  useEffect(() => {
    if (lines.length === 0) {
      return;
    }
    const handle = setTimeout(() => {
      void ask<Preview>({ url: "/api/v1/sales/preview", body: { ...sale, lines: sale.lines.map(({ serial, ...rest }) => { void serial; return rest; }) } }, { quiet: true, onSuccess: (data) => { setPreview(data); setPreviewError(""); } }).then((result) => {
        if (result.ok) return;
        if (result.kind === "busy") {
          setTimeout(() => setRetry((n) => n + 1), 250);
          return;
        }
        setPreview(null);
        setPreviewError(result.message);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [sale, lines.length, ask, retry]);
  const shownPreview = lines.length === 0 ? null : preview;

  function add(hit: Hit) {
    setLines((current) => {
      const same = current.find((line) => line.productId === hit.id && line.variantId === hit.matchedVariantId && !hit.trackSerial);
      if (same) {
        return current.map((line) => (line === same ? { ...line, quantity: String(Number(line.quantity) + 1) } : line));
      }
      return [...current, { key: nextKey, productId: hit.id, variantId: hit.matchedVariantId, label: `${hit.sku} · ${hit.name}`, quantity: "1", discount: "", serial: "", available: hit.available, trackSerial: hit.trackSerial }];
    });
    setNextKey((n) => n + 1);
    setQuery("");
    setHits([]);
    searchRef.current?.focus();
  }

  const total = cents(shownPreview?.total ?? "0");
  const owedBefore = cents(customer?.outstanding ?? "0");
  const advance = cents(customer?.advance ?? "0");
  const paid = tenders.reduce((sum, tender) => sum + cents(tender.amount), 0);
  const limit = takePreviousDue ? total + Math.max(owedBefore, 0) : total;
  const excess = Math.max(paid - total, 0);
  const cashAmount = tenders.filter((tender) => accounts.find((account) => account.id === tender.source)?.kind === "CASH").reduce((sum, tender) => sum + cents(tender.amount), 0);
  const change = !takePreviousDue && excess > 0 && excess <= cashAmount ? excess : 0;
  const tooMuch = paid > limit + (change > 0 ? change : 0) || (excess > 0 && !takePreviousDue && change === 0);
  const due = Math.max(total - paid, 0);
  const needsCustomer = due > 0 && !customer;
  const ready = lines.length > 0 && shownPreview !== null && !tooMuch && !needsCustomer;

  function addTender(source: string, amount: string) {
    setTenders((current) => [...current, { key: nextKey, source, amount, charge: "" }]);
    setNextKey((n) => n + 1);
  }

  function tendersForServer() {
    // the change given back comes off the last cash payment: the server records what the sale took
    let giveBack = change;
    const rows = [...tenders].reverse().map((tender) => {
      const account = accounts.find((row) => row.id === tender.source);
      let amount = cents(tender.amount);
      if (account?.kind === "CASH" && giveBack > 0) {
        const cut = Math.min(giveBack, amount);
        amount -= cut;
        giveBack -= cut;
      }
      return { tender, account, amount };
    }).reverse();
    return rows
      .filter((row) => row.amount > 0)
      .map(({ tender, account, amount }) => (tender.source === "WALLET" ? { method: "WALLET" as const, amount: text(amount) } : { method: account?.kind ?? ("CASH" as const), accountId: tender.source, amount: text(amount), charge: opt(tender.charge) }));
  }

  function complete() {
    void submit<{ id: string }>(
      { url: "/api/v1/sales", body: { ...sale, businessDate: today, ticketId: initial?.ticketId, takePreviousDue: takePreviousDue || undefined, tenders: tendersForServer() } },
      { successMessage: t("pos.saleDone"), goTo: (data) => `/sales/${data.id}` },
    );
  }

  function hold() {
    if (lines.length === 0) return;
    void submit<{ warnings?: string[] }>(
      { url: "/api/v1/pos/tickets", body: { customerId: customer?.id, lines: lines.map((line) => ({ productId: line.productId, variantId: line.variantId ?? undefined, quantity: line.quantity })) } },
      { successMessage: t("pos.held"), onSuccess: (data) => { setNotice((data.warnings ?? []).join(" · ")); clear(); } },
    );
  }

  function clear() {
    setLines([]);
    setTenders([]);
    setCustomer(null);
    setHeaderDiscount("");
    setCharges("");
    setTakePreviousDue(false);
    setPreview(null);
  }

  // the shortcuts act on the latest state
  const actions = useRef({ hold, complete, ready });
  useEffect(() => {
    actions.current = { hold, complete, ready };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "F2") { event.preventDefault(); searchRef.current?.focus(); }
      else if (event.key === "F4") { event.preventDefault(); customerRef.current?.focus(); }
      else if (event.key === "F6") { event.preventDefault(); actions.current.hold(); }
      else if (event.key === "F9") { event.preventDefault(); payRef.current?.focus(); }
      else if (event.key === "F10") { event.preventDefault(); if (actions.current.ready) actions.current.complete(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-[1.3fr_1fr] pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_input]:min-h-11 pointer-coarse:[&_select]:min-h-11" aria-label={t("pos.register")}>
      <section className="grid content-start gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-60 flex-1 gap-1 text-sm">
            {t("pos.searchLabel")}
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && shownHits[0]) {
                  event.preventDefault();
                  add(shownHits[0]);
                }
              }}
              placeholder={t("pos.searchPlaceholder")}
              autoComplete="off"
              autoFocus
            />
          </label>
          <label className="grid gap-1 text-sm">
            {t("pos.category")}
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={select}>
              <option value="">{t("pos.all")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <span className="pb-2 text-sm text-muted">{branchName}</span>
        </div>
        {shownHits.length > 0 ? (
          <ul className="grid max-h-60 gap-1 overflow-auto sm:grid-cols-2" aria-label={t("pos.productsFound")}>
            {shownHits.map((hit) => (
              <li key={hit.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-muted" onClick={() => add(hit)}>
                  <span>
                    {hit.name}
                    <span className="block text-xs text-muted">{hit.sku}</span>
                  </span>
                  <span className="text-right">
                    <span className="block font-medium tabular-nums">{taka(hit.price)}</span>
                    <span className="block text-xs text-muted">{hit.available !== null ? t("pos.avail", { n: hit.available }) : hit.levelName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">{t("pos.cart")}</caption>
            <thead className="text-left text-muted">
              <tr>
                <th className="p-2">{t("pos.colItem")}</th>
                <th className="p-2">{t("pos.colQty")}</th>
                <th className="p-2 text-right">{t("pos.colPrice")}</th>
                {canDiscount ? <th className="p-2">{t("pos.colDiscount")}</th> : null}
                <th className="p-2 text-right">{t("pos.colTotal")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td className="p-4 text-muted" colSpan={6}>
                    {t("pos.emptyCart")}
                  </td>
                </tr>
              ) : null}
              {lines.map((line, index) => (
                <tr key={line.key} className="align-top">
                  <td className="p-2">
                    {line.label}
                    {line.available !== null ? <span className="ml-2 text-xs text-muted">{t("pos.available", { n: line.available })}</span> : null}
                    {line.trackSerial ? <input className={`${cell} mt-1 block w-full`} placeholder={t("pos.serialPlaceholder")} aria-label={t("pos.serial")} value={line.serial} onChange={(event) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, serial: event.target.value } : row)))} /> : null}
                  </td>
                  <td className="p-2">
                    <input className={`${cell} w-20`} inputMode="decimal" aria-label={t("pos.quantity")} value={line.quantity} onChange={(event) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, quantity: event.target.value } : row)))} />
                  </td>
                  <td className="p-2 text-right tabular-nums">{shownPreview?.lines[index]?.unitPrice ? taka(shownPreview.lines[index].unitPrice) : ""}</td>
                  {canDiscount ? (
                    <td className="p-2">
                      <input className={`${cell} w-20`} inputMode="decimal" aria-label={t("pos.lineDiscount")} value={line.discount} onChange={(event) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, discount: event.target.value } : row)))} />
                    </td>
                  ) : null}
                  <td className="p-2 text-right tabular-nums">{shownPreview?.lines[index]?.payable ? taka(shownPreview.lines[index].payable) : ""}</td>
                  <td className="p-2">
                    <Button variant="ghost" size="sm" aria-label={t("pos.remove", { item: line.label })} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}>
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {notice ? <p className="rounded-md border border-warning/30 bg-warning-subtle p-2 text-sm" role="status">{notice}</p> : null}
        {previewError ? <p className="text-sm text-error" role="alert">{previewError}</p> : null}
      </section>

      <section className="grid content-start gap-3">
        <div className="grid gap-1">
          <label className="grid gap-1 text-sm">
            {t("pos.customer")}
            <Input ref={customerRef} value={customer ? customer.name : customerQuery} onChange={(event) => { setCustomer(null); setCustomerQuery(event.target.value); }} placeholder={t("pos.walkIn")} autoComplete="off" />
          </label>
          {customer ? (
            <p className="text-xs text-muted">
              {t("pos.customerLine", { phone: customer.phone ?? "", owes: taka(customer.outstanding), advance: taka(customer.advance) })}
            </p>
          ) : null}
          {shownCustomers.length > 0 && !customer ? (
            <ul className="max-h-48 overflow-auto rounded-md border border-border bg-surface text-sm" aria-label={t("pos.customersFound")}>
              {shownCustomers.map((row) => (
                <li key={row.id}>
                  <button type="button" className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-surface-muted" onClick={() => { setCustomer(row); setCustomerQuery(""); setCustomers([]); }}>
                    <span>{row.name}</span>
                    <span className="text-muted">{t("pos.owes", { amount: taka(row.outstanding) })}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {canLevel ? (
          <label className="grid gap-1 text-sm">
            {t("pos.priceLevel")}
            <select value={level} onChange={(event) => setLevel(event.target.value)} className={select}>
              <option value="">{t("pos.ownLevel")}</option>
              {levels.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {canDiscount ? (
            <label className="grid gap-1 text-sm">
              {t("pos.discount")}
              <Input inputMode="decimal" value={headerDiscount} onChange={(event) => setHeaderDiscount(event.target.value)} placeholder="0.00" />
            </label>
          ) : null}
          <label className="grid gap-1 text-sm">
            {t("pos.charges")}
            <Input inputMode="decimal" value={charges} onChange={(event) => setCharges(event.target.value)} placeholder="0.00" />
          </label>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border p-3 text-sm" aria-live="polite">
          <dt>{t("pos.goods")}</dt>
          <dd className="text-right tabular-nums">{money(shownPreview?.gross)}</dd>
          <dt>{t("pos.discount")}</dt>
          <dd className="text-right tabular-nums">{money(shownPreview?.discount)}</dd>
          <dt>{t("pos.vat")}</dt>
          <dd className="text-right tabular-nums">{money(shownPreview?.vat)}</dd>
          <dt>{t("pos.chargesRow")}</dt>
          <dd className="text-right tabular-nums">{money(shownPreview?.charges)}</dd>
          <dt className="text-base font-semibold">{t("pos.total")}</dt>
          <dd className="text-right text-base font-semibold tabular-nums">{money(shownPreview?.total)}</dd>
          {customer && owedBefore > 0 ? (
            <>
              <dt>{t("pos.previousDue")}</dt>
              <dd className="text-right tabular-nums">{taka(customer.outstanding)}</dd>
            </>
          ) : null}
          {customer && advance > 0 ? (
            <>
              <dt>{t("pos.advanceHeld")}</dt>
              <dd className="text-right tabular-nums">{taka(customer.advance)}</dd>
            </>
          ) : null}
        </dl>
        {customer && owedBefore > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={takePreviousDue} onChange={(event) => setTakePreviousDue(event.target.checked)} />
            {t("pos.takeDue")}
          </label>
        ) : null}

        <fieldset className="grid gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t("pos.payment")}</legend>
          {tenders.map((tender) => {
            const account = accounts.find((row) => row.id === tender.source);
            return (
              <div key={tender.key} className="grid grid-cols-[1fr_6rem_5rem_auto] items-center gap-1 text-sm">
                <span>{tender.source === "WALLET" ? t("pos.advance") : (account?.label ?? "")}</span>
                <input className={cell} inputMode="decimal" aria-label={t("pos.amount")} value={tender.amount} onChange={(event) => setTenders((current) => current.map((row) => (row.key === tender.key ? { ...row, amount: event.target.value } : row)))} />
                {account && account.kind !== "CASH" ? <ChargeInput bare className={cell} accountId={tender.source} amount={tender.amount} value={tender.charge} typed={tender.chargeTyped === true} onChange={(value, typed) => setTenders((current) => current.map((row) => (row.key === tender.key ? { ...row, charge: value, chargeTyped: typed } : row)))} /> : <span />}
                <Button variant="ghost" size="sm" aria-label={t("pos.removePayment")} onClick={() => setTenders((current) => current.filter((row) => row.key !== tender.key))}>
                  ✕
                </Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <select ref={undefined} aria-label={t("pos.addPaymentLabel")} className={`${select} min-w-0 flex-1`} value="" onChange={(event) => { if (event.target.value) addTender(event.target.value, text(Math.max(due, 0))); }}>
              <option value="">{t("pos.addPayment")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
              {customer && advance > 0 ? <option value="WALLET">{t("pos.fromAdvance", { amount: taka(customer.advance) })}</option> : null}
            </select>
            {accounts.find((account) => account.kind === "CASH") ? (
              <Button variant="secondary" size="sm" onClick={() => { const cash = accounts.find((account) => account.kind === "CASH"); if (cash) { setTenders([{ key: nextKey, source: cash.id, amount: text(total), charge: "" }]); setNextKey((n) => n + 1); } }}>
                {t("pos.cashTotal")}
              </Button>
            ) : null}
          </div>
          <input ref={payRef} className="sr-only" aria-hidden tabIndex={-1} readOnly />
          <dl className="grid grid-cols-2 gap-x-4 text-sm">
            <dt>{t("pos.paid")}</dt>
            <dd className="text-right tabular-nums">{taka(text(paid))}</dd>
            {change > 0 ? (
              <>
                <dt className="font-medium">{t("pos.change")}</dt>
                <dd className="text-right font-medium tabular-nums">{taka(text(change))}</dd>
              </>
            ) : null}
            <dt>{t("pos.onCredit")}</dt>
            <dd className="text-right tabular-nums">{taka(text(due))}</dd>
          </dl>
          {needsCustomer ? <p className="text-sm text-error">{t("pos.needCustomer")}</p> : null}
          {tooMuch ? <p className="text-sm text-error">{takePreviousDue ? t("pos.tooMuchDue") : t("pos.tooMuch")}</p> : null}
        </fieldset>

        {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button loading={pending} disabled={!ready} onClick={complete}>
            {t("pos.complete")}
          </Button>
          <Button variant="secondary" disabled={lines.length === 0} onClick={hold}>
            {t("pos.hold")}
          </Button>
          <Button variant="ghost" onClick={clear}>
            {t("pos.clear")}
          </Button>
        </div>
      </section>
    </div>
  );
}
