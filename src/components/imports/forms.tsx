"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type PreviewRow = { rowNumber: number; sku: string; name: string; status: string; message: string };
type ResultRow = { rowNumber: number; status: string; message: string };

export function ProductImportForm({ canExport }: { canExport: boolean }) {
  const [csv, setCsv] = useState("sku,name,purchasePrice,sellingPrice,wholesalePrice,minimumPrice,reorderLevel,barcode\n");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<ResultRow[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function run(path: string, idempotent: boolean) {
    setPending(true);
    setMessage("");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (idempotent) {
      headers["idempotency-key"] = crypto.randomUUID();
    }
    const response = await fetch(path, { method: "POST", headers, body: JSON.stringify({ fileName: "products.csv", csv }) });
    const body = (await response.json()) as { data?: PreviewRow[] | { rows?: ResultRow[] }; error?: { message?: string } };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error?.message ?? "The CSV was not imported.");
      return;
    }
    if (idempotent) {
      const rows = body.data && "rows" in body.data ? body.data.rows ?? [] : [];
      setResult(rows);
      setPreview([]);
      return;
    }
    setPreview(Array.isArray(body.data) ? body.data : []);
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
  const [businessDate, setOccurredOn] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid max-w-3xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setMessage("");
        void fetch("/api/v1/inventory/opening-stock/import", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ fileName: "opening-stock.csv", csv, businessDate }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { error?: { message?: string }; data?: { successRows?: number; failedRows?: number } };
            if (!response.ok) {
              setMessage(body.error?.message ?? "The CSV was not imported.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
      }}
    >
      <label className="grid gap-1 text-sm">
        Date
        <input name="businessDate" type="date" required aria-label="Opening date" className="h-10 rounded-md border border-border bg-surface px-3 text-sm" value={businessDate} onChange={(event) => setOccurredOn(event.target.value)} />
      </label>
      <textarea aria-label="Opening stock CSV" className="min-h-32 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm" value={csv} onChange={(event) => setCsv(event.target.value)} />
      <p className="text-sm text-muted">Rack is kept in the file and is not stored. Unit cost is not posted to accounting.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Import opening stock
      </Button>
    </form>
  );
}
