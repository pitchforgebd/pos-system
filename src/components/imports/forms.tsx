"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useSubmit } from "@/lib/client/use-submit";

type PreviewRow = { rowNumber: number; sku: string; name: string; status: string; message: string };
type ResultRow = { rowNumber: number; status: string; message: string };

export function ProductImportForm({ canExport }: { canExport: boolean }) {
  const [csv, setCsv] = useState("sku,name,purchasePrice,sellingPrice,wholesalePrice,minimumPrice,reorderLevel,barcode,genericName,vatType,vatRate,isService,dealerPrice\n");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<ResultRow[]>([]);
  const { submit, pending, message } = useSubmit();

  async function run(path: string, confirm: boolean) {
    // The preview only reads (no toast, no refresh); the confirmed import writes, and this form shows its result.
    const outcome = await submit<PreviewRow[] | { rows?: ResultRow[] }>(
      { url: path, body: { fileName: "products.csv", csv } },
      confirm ? { successMessage: "ইমপোর্ট সম্পন্ন হয়েছে। (Import finished.)", refresh: false } : { quiet: true },
    );
    if (!outcome.ok) {
      return;
    }
    if (confirm) {
      const rows = outcome.data && "rows" in outcome.data ? outcome.data.rows ?? [] : [];
      setResult(rows);
      setPreview([]);
      return;
    }
    setPreview(Array.isArray(outcome.data) ? outcome.data : []);
    setResult([]);
  }

  return (
    <div className="grid max-w-3xl gap-3">
      <textarea aria-label="Product CSV" className="min-h-40 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm" value={csv} onChange={(event) => setCsv(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" loading={pending} onClick={() => void run("/api/v1/products/import/preview", false)}>
          Preview
        </Button>
        <Button type="button" loading={pending} onClick={() => void run("/api/v1/products/import", true)}>
          Confirm import
        </Button>
        {canExport ? (
          <Button href="/api/v1/products/export" variant="secondary">
            Export CSV
          </Button>
        ) : null}
      </div>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      {preview.length > 0 ? (
        <ul className="text-sm">
          {preview.map((row) => (
            <li key={row.rowNumber}>
              {row.rowNumber}. {row.sku || "—"} {row.name} — {row.status}. {row.message}
            </li>
          ))}
        </ul>
      ) : null}
      {result.length > 0 ? (
        <ul className="text-sm">
          {result.map((row) => (
            <li key={row.rowNumber}>
              {row.rowNumber}. {row.status}. {row.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function OpeningImportForm() {
  const [csv, setCsv] = useState("sku,quantity,unitCost,lot,manufacturedOn,expiresOn,rack\n");
  const [openingDate, setOpeningDate] = useState("");
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-3xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ url: "/api/v1/inventory/opening-stock/import", body: { fileName: "opening-stock.csv", csv, businessDate: openingDate } });
      }}
    >
      <label className="grid gap-1 text-sm">
        Date
        <input name="businessDate" type="date" required aria-label="Opening date" className="h-10 rounded-md border border-border bg-surface px-3 text-sm" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} />
      </label>
      <textarea aria-label="Opening stock CSV" className="min-h-32 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm" value={csv} onChange={(event) => setCsv(event.target.value)} />
      <p className="text-sm text-muted">Rack is kept in the file and is not stored. The rows that import become one opening-stock document with one journal, valued at the unit cost in the file.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Import opening stock
      </Button>
    </form>
  );
}
