"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProductForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        const file = form.get("file");
        void fetch("/api/v1/products", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sku: form.get("sku"),
            name: form.get("name"),
            purchasePrice: form.get("purchasePrice"),
            sellingPrice: form.get("sellingPrice"),
            wholesalePrice: form.get("wholesalePrice"),
            minimumPrice: form.get("minimumPrice"),
            reorderLevel: form.get("reorderLevel") || "0",
            barcode: String(form.get("barcode") || "") || undefined,
            trackStock: form.get("trackStock") === "on",
            trackExpiry: form.get("trackExpiry") === "on",
          }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { data?: { id?: string }; error?: { message?: string } };
            if (!response.ok || !body.data?.id) {
              setMessage(body.error?.message ?? "The product was not saved.");
              return;
            }
            if (file instanceof File && file.size > 0) {
              const photo = new FormData();
              photo.set("file", file);
              const uploaded = await fetch(`/api/v1/products/${body.data.id}/image`, { method: "POST", body: photo });
              if (!uploaded.ok) {
                const payload = (await uploaded.json()) as { error?: { message?: string } };
                setMessage(payload.error?.message ?? "The product was saved, but the photo was not.");
                return;
              }
            }
            window.location.replace("/products");
          })
          .finally(() => setPending(false));
      }}
    >
      <Input name="sku" required placeholder="SKU" aria-label="SKU" />
      <Input name="name" required placeholder="Name" aria-label="Name" />
      <Input name="purchasePrice" required placeholder="Purchase price" aria-label="Purchase price" />
      <Input name="sellingPrice" required placeholder="Selling price" aria-label="Selling price" />
      <Input name="wholesalePrice" required placeholder="Wholesale price" aria-label="Wholesale price" />
      <Input name="minimumPrice" required placeholder="Minimum price" aria-label="Minimum price" />
      <Input name="reorderLevel" placeholder="Reorder level" aria-label="Reorder level" defaultValue="0" />
      <Input name="barcode" placeholder="Barcode" aria-label="Barcode" />
      <label className="flex items-center gap-2 text-sm">
        <input name="trackStock" type="checkbox" defaultChecked />
        Track stock
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="trackExpiry" type="checkbox" />
        Track expiry
      </label>
      <label className="grid gap-1 text-sm">
        Photo
        <input name="file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Product photo" />
      </label>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save product
      </Button>
    </form>
  );
}
