"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

// The purchase form (P05): the vendor, the bill's lines with their discount and VAT, the haulage and what it cost, and how far to take it:
// saved as a draft, sent to the vendor (ordered), or received at once. The cost under the lines is worked out by the server (what receiving
// will use); nothing here adds up money.

type Option = { id: string; label: string };
export type AccountOption = { id: string; label: string; kind: "CASH" | "BANK" | "MOBILE" };
type Found = { id: string; sku: string; name: string; unit: string | null; trackExpiry: boolean; trackSerial: boolean; lastCost: string; lastSupplierId: string | null };

type Line = {
  key: number;
  productId: string;
  label: string;
  trackExpiry: boolean;
  trackSerial: boolean;
  quantity: string;
  unitCost: string;
  discount: string;
  vatRate: string;
  lot: string;
  manufacturedOn: string;
  expiresOn: string;
  serials: string;
};

export type PurchaseFormValues = {
  id?: string;
  status?: "DRAFT" | "ORDERED";
  supplierId: string;
  businessDate: string;
  warehouseId: string;
  supplierInvoiceNo: string;
  note: string;
  headerDiscount: string;
  transportCost: string;
  otherCost: string;
  transporterId: string;
  vehicleNo: string;
  transportPaidWith: "CASH" | "BANK" | "CREDIT";
  lines: Array<Omit<Line, "key">>;
};

type Preview = { subtotal: string; discountTotal: string; vatTotal: string; total: string; haulage: string; landedTotal: string; lines: Array<{ lineTotal: string; landedUnitCost: string }> };

const select = "h-10 rounded-md border border-border bg-surface px-2";
const cell = "h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-sm";
const blank = (found: Found): Omit<Line, "key"> => ({
  productId: found.id,
  label: `${found.sku} · ${found.name}`,
  trackExpiry: found.trackExpiry,
  trackSerial: found.trackSerial,
  quantity: "1",
  unitCost: found.lastCost,
  discount: "",
  vatRate: "",
  lot: "",
  manufacturedOn: "",
  expiresOn: "",
  serials: "",
});
const opt = (value: string) => (value.trim() === "" ? undefined : value.trim());

export function PurchaseForm({
  suppliers,
  warehouses,
  accounts,
  initial,
  today,
}: {
  suppliers: Option[];
  warehouses: Option[];
  accounts: AccountOption[];
  /** The purchase being changed; none for a new one. */
  initial?: PurchaseFormValues;
  today: string;
}) {
  const { submit, pending, message } = useSubmit();
  // what the cost would be is asked of the server through its own hook (a read that has to be a POST), so it never blocks saving
  const { submit: askCost } = useSubmit();
  const [values, setValues] = useState<PurchaseFormValues>(
    initial ?? {
      supplierId: suppliers[0]?.id ?? "",
      businessDate: today,
      warehouseId: warehouses[0]?.id ?? "",
      supplierInvoiceNo: "",
      note: "",
      headerDiscount: "",
      transportCost: "",
      otherCost: "",
      transporterId: "",
      vehicleNo: "",
      transportPaidWith: "CASH",
      lines: [],
    },
  );
  const [keyed, setKeyed] = useState<Line[]>(() => (initial?.lines ?? []).map((line, index) => ({ ...line, key: index })));
  const [nextKey, setNextKey] = useState(keyed.length);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [receivedOn, setReceivedOn] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState(accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");

  const set = <K extends keyof PurchaseFormValues>(name: K, value: PurchaseFormValues[K]) => setValues((current) => ({ ...current, [name]: value }));
  const setLine = (key: number, patch: Partial<Line>) => setKeyed((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  // product search: 20 rows from the database after a short pause
  useEffect(() => {
    if (query.trim() === "") {
      return;
    }
    const handle = setTimeout(() => {
      void fetch(`/api/v1/purchases/products?q=${encodeURIComponent(query.trim())}`)
        .then((response) => (response.ok ? response.json() : { data: [] }))
        .then((body: { data: Found[] }) => setFound(body.data ?? []))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);
  const shownFound = query.trim() === "" ? [] : found;

  const costBody = useMemo(
    () => ({
      headerDiscount: opt(values.headerDiscount),
      transportCost: opt(values.transportCost),
      otherCost: opt(values.otherCost),
      lines: keyed.map((line) => ({ quantity: line.quantity, unitCost: line.unitCost, discount: opt(line.discount), vatRate: opt(line.vatRate) })),
    }),
    [keyed, values.headerDiscount, values.transportCost, values.otherCost],
  );

  // what it costs, as the server will work it out
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (keyed.length === 0) {
      return;
    }
    const handle = setTimeout(() => {
      void askCost<Preview>({ url: "/api/v1/purchases/cost", body: costBody }, { quiet: true, onSuccess: (data) => { setPreview(data); setPreviewError(""); } }).then((result) => {
        if (result.ok) {
          return;
        }
        if (result.kind === "busy") {
          setTimeout(() => setRetry((n) => n + 1), 300);
          return;
        }
        setPreview(null);
        setPreviewError(result.message || "Check the figures.");
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [costBody, keyed.length, askCost, retry]);
  const shownPreview = keyed.length === 0 ? null : preview;

  function addProduct(item: Found) {
    setKeyed((current) => [...current, { ...blank(item), key: nextKey }]);
    setNextKey((n) => n + 1);
    setQuery("");
    setFound([]);
  }

  function payload() {
    return {
      supplierId: values.supplierId,
      businessDate: values.businessDate,
      warehouseId: opt(values.warehouseId),
      supplierInvoiceNo: opt(values.supplierInvoiceNo),
      note: opt(values.note),
      headerDiscount: opt(values.headerDiscount),
      transportCost: opt(values.transportCost),
      otherCost: opt(values.otherCost),
      transporterId: opt(values.transporterId),
      vehicleNo: opt(values.vehicleNo),
      transportPaidWith: values.transportPaidWith,
      lines: keyed.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitCost: line.unitCost,
        discount: opt(line.discount),
        vatRate: opt(line.vatRate),
        lot: opt(line.lot),
        manufacturedOn: opt(line.manufacturedOn),
        expiresOn: opt(line.expiresOn),
        serials: line.trackSerial ? line.serials.split(/\r?\n/).map((serial) => serial.trim()).filter(Boolean) : undefined,
      })),
    };
  }

  function save(mode: "draft" | "ordered" | "received") {
    const account = accounts.find((row) => row.id === paymentAccountId);
    const paying = mode === "received" && paymentAmount.trim() !== "" && Number(paymentAmount) > 0;
    void submit<{ id: string }>(
      {
        url: "/api/v1/purchases",
        body: {
          ...payload(),
          mode,
          receivedOn: mode === "received" ? receivedOn : undefined,
          paymentAmount: paying ? paymentAmount : undefined,
          paymentMethod: paying ? account?.kind : undefined,
          paymentAccountId: paying ? paymentAccountId : undefined,
        },
      },
      { successMessage: mode === "draft" ? "খসড়া সংরক্ষিত হয়েছে। (Draft saved.)" : mode === "ordered" ? "অর্ডার পাঠানো হয়েছে। (Order placed.)" : "ক্রয় গ্রহণ করা হয়েছে। (Purchase received.)", goTo: (data) => `/purchases/${data.id}` },
    );
  }

  function update() {
    void submit<{ id: string }>(
      { url: `/api/v1/purchases/${initial?.id}`, method: "PATCH", body: payload() },
      { successMessage: "পরিবর্তন সংরক্ষিত হয়েছে। (Changes saved.)", goTo: () => `/purchases/${initial?.id}` },
    );
  }

  const ready = values.supplierId !== "" && keyed.length > 0;

  return (
    <form className="grid gap-5" onSubmit={(event) => event.preventDefault()}>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-sm">
          Supplier
          <select value={values.supplierId} onChange={(event) => set("supplierId", event.target.value)} required className={select}>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Bill date
          <Input type="date" value={values.businessDate} onChange={(event) => set("businessDate", event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Vendor&apos;s invoice no.
          <Input value={values.supplierInvoiceNo} onChange={(event) => set("supplierInvoiceNo", event.target.value)} maxLength={64} />
        </label>
        <label className="grid gap-1 text-sm">
          Warehouse
          <select value={values.warehouseId} onChange={(event) => set("warehouseId", event.target.value)} className={select}>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="grid gap-2">
        <label className="grid gap-1 text-sm">
          Add a product (name, SKU or barcode)
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" autoComplete="off" />
        </label>
        {shownFound.length > 0 ? (
          <ul className="max-h-64 overflow-auto rounded-md border border-border bg-surface text-sm" role="listbox" aria-label="Products found">
            {shownFound.map((item) => (
              <li key={item.id}>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted" onClick={() => addProduct(item)}>
                  <span>
                    {item.sku} · {item.name}
                  </span>
                  <span className="text-muted">last {item.lastCost}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {keyed.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">Purchase lines</caption>
            <thead className="text-left text-muted">
              <tr>
                <th className="p-1">Product</th>
                <th className="p-1">Quantity</th>
                <th className="p-1">Unit cost</th>
                <th className="p-1">Discount</th>
                <th className="p-1">VAT %</th>
                <th className="p-1 text-right">Line total</th>
                <th className="p-1 text-right">Landed unit</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {keyed.map((line, index) => (
                <tr key={line.key} className="align-top">
                  <td className="p-1">
                    <div>{line.label}</div>
                    {line.trackExpiry ? (
                      <div className="mt-1 grid grid-cols-3 gap-1">
                        <input className={cell} placeholder="Lot" aria-label="Lot" value={line.lot} onChange={(event) => setLine(line.key, { lot: event.target.value })} />
                        <input className={cell} type="date" aria-label="Manufactured on" value={line.manufacturedOn} onChange={(event) => setLine(line.key, { manufacturedOn: event.target.value })} />
                        <input className={cell} type="date" aria-label="Expiry date" value={line.expiresOn} onChange={(event) => setLine(line.key, { expiresOn: event.target.value })} />
                      </div>
                    ) : null}
                    {line.trackSerial ? (
                      <textarea className={`${cell} mt-1 h-20 w-full`} placeholder="One IMEI or serial per line" aria-label="Serial numbers" value={line.serials} onChange={(event) => setLine(line.key, { serials: event.target.value })} />
                    ) : null}
                  </td>
                  <td className="p-1">
                    <input className={`${cell} w-24`} inputMode="decimal" aria-label="Quantity" value={line.quantity} onChange={(event) => setLine(line.key, { quantity: event.target.value })} />
                  </td>
                  <td className="p-1">
                    <input className={`${cell} w-28`} inputMode="decimal" aria-label="Unit cost" value={line.unitCost} onChange={(event) => setLine(line.key, { unitCost: event.target.value })} />
                  </td>
                  <td className="p-1">
                    <input className={`${cell} w-24`} inputMode="decimal" aria-label="Line discount" value={line.discount} onChange={(event) => setLine(line.key, { discount: event.target.value })} />
                  </td>
                  <td className="p-1">
                    <input className={`${cell} w-20`} inputMode="decimal" aria-label="VAT rate" value={line.vatRate} onChange={(event) => setLine(line.key, { vatRate: event.target.value })} />
                  </td>
                  <td className="p-1 text-right tabular-nums">{shownPreview?.lines[index]?.lineTotal ?? ""}</td>
                  <td className="p-1 text-right tabular-nums">{shownPreview?.lines[index]?.landedUnitCost ?? ""}</td>
                  <td className="p-1">
                    <Button variant="ghost" size="sm" onClick={() => setKeyed((current) => current.filter((row) => row.key !== line.key))} aria-label={`Remove ${line.label}`}>
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

      <div className="grid gap-5 md:grid-cols-2">
        <fieldset className="grid gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Discount and haulage</legend>
          <label className="grid gap-1 text-sm">
            Discount on the whole bill
            <Input inputMode="decimal" value={values.headerDiscount} onChange={(event) => set("headerDiscount", event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              Haulage (carrier&apos;s hire)
              <Input inputMode="decimal" value={values.transportCost} onChange={(event) => set("transportCost", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              Labour and other costs
              <Input inputMode="decimal" value={values.otherCost} onChange={(event) => set("otherCost", event.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              Carrier
              <select value={values.transporterId} onChange={(event) => set("transporterId", event.target.value)} className={select}>
                <option value="">None</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Vehicle no.
              <Input value={values.vehicleNo} onChange={(event) => set("vehicleNo", event.target.value)} maxLength={32} />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            The haulage is paid
            <select value={values.transportPaidWith} onChange={(event) => set("transportPaidWith", event.target.value as PurchaseFormValues["transportPaidWith"])} className={select}>
              <option value="CASH">In cash</option>
              <option value="BANK">From the bank</option>
              <option value="CREDIT">On the carrier&apos;s credit (we owe the carrier)</option>
            </select>
          </label>
        </fieldset>

        <div className="grid content-start gap-3">
          <label className="grid gap-1 text-sm">
            Note
            <Input value={values.note} onChange={(event) => set("note", event.target.value)} maxLength={500} />
          </label>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border p-3 text-sm" aria-live="polite">
            <dt>Goods</dt>
            <dd className="text-right tabular-nums">{shownPreview?.subtotal ?? "—"}</dd>
            <dt>Discounts</dt>
            <dd className="text-right tabular-nums">{shownPreview?.discountTotal ?? "—"}</dd>
            <dt>VAT</dt>
            <dd className="text-right tabular-nums">{shownPreview?.vatTotal ?? "—"}</dd>
            <dt className="font-medium">Owed to the vendor</dt>
            <dd className="text-right font-medium tabular-nums">{shownPreview?.total ?? "—"}</dd>
            <dt>Haulage and other costs</dt>
            <dd className="text-right tabular-nums">{shownPreview?.haulage ?? "—"}</dd>
            <dt className="font-medium">What it costs altogether</dt>
            <dd className="text-right font-medium tabular-nums">{shownPreview?.landedTotal ?? "—"}</dd>
          </dl>
          {previewError && keyed.length > 0 ? <p className="text-sm text-error">{previewError}</p> : null}
        </div>
      </div>

      {!initial ? (
        <fieldset className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-3">
          <legend className="px-1 text-sm font-medium">If the goods are received now</legend>
          <label className="grid gap-1 text-sm">
            Received on
            <Input type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Paid to the vendor now
            <Input inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0.00" />
          </label>
          <label className="grid gap-1 text-sm">
            Paid from
            <select value={paymentAccountId} onChange={(event) => setPaymentAccountId(event.target.value)} className={select}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      ) : null}

      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {initial ? (
          <Button loading={pending} disabled={!ready} onClick={update}>
            Save changes
          </Button>
        ) : (
          <>
            <Button variant="secondary" loading={pending} disabled={!ready} onClick={() => save("draft")}>
              Save as draft
            </Button>
            <Button variant="secondary" loading={pending} disabled={!ready} onClick={() => save("ordered")}>
              Order from the vendor
            </Button>
            <Button loading={pending} disabled={!ready} onClick={() => save("received")}>
              Receive the goods now
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
