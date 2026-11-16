"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

export function ProductForm() {
  const { ph } = useI18n();
  const router = useRouter();
  const [photoMessage, setPhotoMessage] = useState("");
  const { submit, pending, message: serverMessage } = useSubmit();
  const message = photoMessage || serverMessage;

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const file = form.get("file");
        setPhotoMessage("");
        void (async () => {
          const created = await submit<{ id: string }>(
            {
              url: "/api/v1/products",
              body: {
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
              },
            },
            { successMessage: ph("Product saved."), refresh: false },
          );
          if (!created.ok) {
            return;
          }
          if (file instanceof File && file.size > 0) {
            const photo = new FormData();
            photo.set("file", file);
            const uploaded = await submit({ url: `/api/v1/products/${created.data.id}/image`, body: photo }, { quiet: true });
            if (!uploaded.ok) {
              setPhotoMessage(`${ph("The product was saved, but the photo was not:")} ${uploaded.message}`);
              return;
            }
          }
          router.push("/products");
        })();
      }}
    >
      <Field label={ph("SKU")} hint={ph("The shop's own code for the product, different for each product.")}>
        <Input name="sku" required />
      </Field>
      <Field label={ph("Name")}>
        <Input name="name" required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={ph("Purchase price")} hint={ph("What one unit cost you.")}>
          <Input name="purchasePrice" required />
        </Field>
        <Field label={ph("Selling price")} hint={ph("The retail price of one unit.")}>
          <Input name="sellingPrice" required />
        </Field>
        <Field label={ph("Wholesale price")}>
          <Input name="wholesalePrice" required />
        </Field>
        <Field label={ph("Minimum price")} hint={ph("The lowest price a sale may go to; it cannot be more than the selling or wholesale price.")}>
          <Input name="minimumPrice" required />
        </Field>
        <Field label={ph("Reorder level")} hint={ph("The stock at or below which the product shows as low.")}>
          <Input name="reorderLevel" defaultValue="0" />
        </Field>
        <Field label={ph("Barcode")} hint={ph("Optional: scan or type it; one can be made later.")}>
          <Input name="barcode" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input name="trackStock" type="checkbox" defaultChecked />
        {ph("Track stock")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="trackExpiry" type="checkbox" />
        {ph("Track expiry")}
      </label>
      <label className="grid gap-1 text-sm">
        {ph("Photo")}
        <input name="file" type="file" accept="image/jpeg,image/png,image/webp" aria-label={ph("Product photo")} />
      </label>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Save product")}
      </Button>
    </form>
  );
}
