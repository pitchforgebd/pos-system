"use client";

import { useState } from "react";

import { BarcodeSvg } from "@/components/print/barcode-svg";
import { PrintButton } from "@/components/print/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Label = { barcode: string; product: string; sellingPrice: string; copies: number; level: string; format: "A4" | "LABEL_38X25" };

/** Prepares labels for one barcode: copies, the price level whose price is printed, and the layout (an A4 sheet or a 38 x 25 mm label). */
export function BarcodePrintForm({ barcodeId, levels }: { barcodeId: string; levels: string[] }) {
  const [copies, setCopies] = useState("1");
  const [level, setLevel] = useState(levels[0] ?? "");
  const [format, setFormat] = useState<"A4" | "LABEL_38X25">("A4");
  const { submit, pending, message } = useSubmit();
  const [label, setLabel] = useState<Label | null>(null);
  const thermal = label?.format === "LABEL_38X25";

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
        <Input aria-label="Copies" value={copies} onChange={(event) => setCopies(event.target.value)} className="w-20" />
        {levels.length > 0 ? (
          <select aria-label="Price level" value={level} onChange={(event) => setLevel(event.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
            {levels.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
        <select aria-label="Label size" value={format} onChange={(event) => setFormat(event.target.value as "A4" | "LABEL_38X25")} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="A4">A4 sheet</option>
          <option value="LABEL_38X25">38 × 25 mm label</option>
        </select>
        <Button type="submit" size="sm" loading={pending}>
          Prepare label
        </Button>
      </form>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      {label ? (
        <div className="space-y-2">
          <PrintButton label="Print labels" />
          {thermal ? <style>{"@media print { @page { size: 38mm 25mm; margin: 0 } }"}</style> : null}
          <div className={thermal ? "print-sheet" : "print-sheet grid grid-cols-3 gap-2"}>
            {Array.from({ length: label.copies }, (_, index) => (
              <div
                key={`${label.barcode}-${index}`}
                className={thermal ? "flex flex-col items-center justify-center overflow-hidden border border-border p-1 text-center" : "flex flex-col items-center border border-border p-2 text-center"}
                style={thermal ? { width: "38mm", height: "25mm", breakAfter: "page" } : undefined}
              >
                <p className={thermal ? "w-full truncate text-[8px] leading-tight font-semibold" : "w-full truncate text-xs font-semibold"}>{label.product}</p>
                <BarcodeSvg code={label.barcode} height={thermal ? 22 : 28} className={thermal ? "h-[12mm] w-full" : "h-14 w-full"} />
                <p className={thermal ? "text-[9px] font-semibold" : "text-sm font-semibold"}>
                  {label.sellingPrice} <span className="font-normal text-muted">{label.level}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
