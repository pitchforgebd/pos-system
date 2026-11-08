"use client";

import { useState } from "react";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Label = { barcode: string; product: string; sellingPrice: string; copies: number };

export function BarcodePrintForm({ barcodeId }: { barcodeId: string }) {
  const [copies, setCopies] = useState("1");
  const { submit, pending, message } = useSubmit();
  const [label, setLabel] = useState<Label | null>(null);

  return (
    <div className="grid gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // Preparing a label only reads: no toast, no page refresh.
          void submit<Label>({ url: "/api/v1/products/barcodes/print", body: { barcodeId, copies: Number(copies) } }, { quiet: true, onSuccess: (data) => setLabel(data) });
        }}
      >
        <Input aria-label="Copies" value={copies} onChange={(event) => setCopies(event.target.value)} className="w-20" />
        <Button type="submit" size="sm" loading={pending}>
          Prepare label
        </Button>
      </form>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      {label ? (
        <div className="space-y-2">
          <PrintButton label="Print labels" />
          <PrintSheet title={label.product} thermal>
            {Array.from({ length: label.copies }, (_, index) => (
              <div key={`${label.barcode}-${index}`} className="border-b border-border py-2">
                <p className="font-mono text-base">{label.barcode}</p>
                <p>{label.sellingPrice}</p>
              </div>
            ))}
          </PrintSheet>
        </div>
      ) : null}
    </div>
  );
}
