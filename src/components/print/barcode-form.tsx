"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

import { BarcodeSvg } from "@/components/print/barcode-svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

type Format = "A4" | "A4_SMALL" | "LABEL_38X25" | "LABEL_50X25" | "LABEL_40X30" | "LABEL_50X30" | "LABEL_2UP_38X25";
type Label = { barcode: string; product: string; sku?: string; shop?: string; sellingPrice: string; copies: number; level: string; format: Format };

/**
 * The layouts. `page` is the paper the printer is told about (an A4 sheet, or one thermal label, or a two-label row of a roll); `across` is
 * how many labels stand side by side on it; `w` x `h` is one label in millimetres.
 */
const LAYOUTS: Record<Format, { name: string; page: string; margin: string; across: number; w: number; h: number; thermal: boolean }> = {
  A4: { name: "A4 sheet, 3 across (63 × 38 mm)", page: "A4", margin: "8mm", across: 3, w: 63, h: 38, thermal: false },
  A4_SMALL: { name: "A4 sheet, 5 across (38 × 21 mm)", page: "A4", margin: "8mm", across: 5, w: 38, h: 21, thermal: false },
  LABEL_38X25: { name: "Thermal label 38 × 25 mm", page: "38mm 25mm", margin: "0", across: 1, w: 38, h: 25, thermal: true },
  LABEL_50X25: { name: "Thermal label 50 × 25 mm", page: "50mm 25mm", margin: "0", across: 1, w: 50, h: 25, thermal: true },
  LABEL_40X30: { name: "Thermal label 40 × 30 mm", page: "40mm 30mm", margin: "0", across: 1, w: 40, h: 30, thermal: true },
  LABEL_50X30: { name: "Thermal label 50 × 30 mm", page: "50mm 30mm", margin: "0", across: 1, w: 50, h: 30, thermal: true },
  LABEL_2UP_38X25: { name: "Thermal roll, 2 across (38 × 25 mm)", page: "80mm 25mm", margin: "0", across: 2, w: 38, h: 25, thermal: true },
};

function OneLabel({ label, layout }: { label: Label; layout: (typeof LAYOUTS)[Format] }) {
  const small = layout.h <= 25;
  return (
    <div
      className="flex flex-col items-center justify-center overflow-hidden bg-white text-center text-black"
      style={{ width: `${layout.w}mm`, height: `${layout.h}mm`, padding: "1mm", boxSizing: "border-box", border: layout.thermal ? "0" : "0.2mm dashed #999" }}
    >
      {label.shop && !small ? <p style={{ fontSize: "6pt", lineHeight: 1.1 }} className="w-full truncate">{label.shop}</p> : null}
      <p style={{ fontSize: small ? "6.5pt" : "8pt", lineHeight: 1.15 }} className="w-full truncate font-semibold">{label.product}</p>
      <BarcodeSvg code={label.barcode} height={22} className="w-full" />
      <p style={{ fontSize: small ? "8pt" : "9.5pt", lineHeight: 1.1 }} className="font-bold">৳ {label.sellingPrice}</p>
    </div>
  );
}

/** What goes to the printer: only the labels (the rest of the page is hidden while printing), at the paper size of the layout. */
function PrintArea({ label }: { label: Label }) {
  const layout = LAYOUTS[label.format] ?? LAYOUTS.A4;
  const labels = Array.from({ length: label.copies }, (_, index) => index);
  const rows: number[][] = [];
  for (let i = 0; i < labels.length; i += layout.across) rows.push(labels.slice(i, i + layout.across));
  return (
    <div className="label-print">
      <style>{`@media print { @page { size: ${layout.page}; margin: ${layout.margin}; } }`}</style>
      {layout.thermal
        ? rows.map((row, index) => (
            <div key={index} style={{ display: "flex", gap: layout.across > 1 ? "4mm" : 0, breakAfter: "page", pageBreakAfter: "always" }}>
              {row.map((n) => <OneLabel key={n} label={label} layout={layout} />)}
            </div>
          ))
        : (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${layout.across}, ${layout.w}mm)`, gap: "1.5mm" }}>
              {labels.map((n) => (
                <div key={n} style={{ breakInside: "avoid" }}>
                  <OneLabel label={label} layout={layout} />
                </div>
              ))}
            </div>
          )}
    </div>
  );
}

/** Prepares labels for one barcode: copies, the price level whose price is printed, and the layout (an A4 sheet or a thermal label). */
export function BarcodePrintForm({ barcodeId, levels }: { barcodeId: string; levels: string[] }) {
  const { ph } = useI18n();
  const [copies, setCopies] = useState("1");
  const [level, setLevel] = useState(levels[0] ?? "");
  const [format, setFormat] = useState<Format>("A4");
  const { submit, pending, message } = useSubmit();
  const [label, setLabel] = useState<Label | null>(null);

  return (
    <div className="grid gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // Preparing a label only reads: no toast, no page refresh. The server records the print.
          void submit<Label>({ url: "/api/v1/products/barcodes/print", body: { barcodeId, copies: Number(copies), level: level || undefined, format } }, { quiet: true, onSuccess: (data) => setLabel(data) });
        }}
      >
        <Input aria-label={ph("Copies")} value={copies} onChange={(event) => setCopies(event.target.value)} className="w-20" inputMode="numeric" />
        {levels.length > 0 ? (
          <select aria-label={ph("Price level")} value={level} onChange={(event) => setLevel(event.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
            {levels.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
        <select aria-label={ph("Label size")} value={format} onChange={(event) => setFormat(event.target.value as Format)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
          {(Object.keys(LAYOUTS) as Format[]).map((key) => (
            <option key={key} value={key}>
              {ph(LAYOUTS[key].name)}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" loading={pending}>
          {ph("Prepare label")}
        </Button>
      </form>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      {label ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => window.print()}>
              {ph("Print labels")}
            </Button>
            <span className="text-xs text-muted">{ph("In the print window choose the label printer and set the margins to none.")}</span>
          </div>
          {/* the preview on the screen: the first label as it will print */}
          <div className="inline-block rounded border border-border bg-white p-2">
            <OneLabel label={label} layout={LAYOUTS[label.format] ?? LAYOUTS.A4} />
          </div>
          {/* a label exists only after a click, so the page is in the browser here */}
          {typeof document !== "undefined" ? createPortal(<PrintArea label={label} />, document.body) : null}
        </div>
      ) : null}
    </div>
  );
}
