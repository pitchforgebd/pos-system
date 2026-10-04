"use client";

import { useState } from "react";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BarcodePrintForm({ barcodeId }: { barcodeId: string }) {
  const [copies, setCopies] = useState("1");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [label, setLabel] = useState<{ barcode: string; product: string; sellingPrice: string; copies: number } | null>(null);

  return (
    <div className="grid gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setMessage("");
          void fetch("/api/v1/products/barcodes/print", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ barcodeId, copies: Number(copies) }),
          })
            .then(async (response) => {
              const body = (await response.json()) as { error?: { message?: string }; data?: { barcode: string; product: string; sellingPrice: string; copies: number } };
              if (!response.ok || !body.data) {
                setMessage(body.error?.message ?? "The label was not prepared.");
                return;
              }
              setLabel(body.data);
            })
            .finally(() => setPending(false));
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
