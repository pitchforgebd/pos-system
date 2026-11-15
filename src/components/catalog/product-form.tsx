"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
            { successMessage: "পণ্য সংরক্ষিত হয়েছে। (Product saved.)", refresh: false },
          );
          if (!created.ok) {
            return;
          }
          if (file instanceof File && file.size > 0) {
            const photo = new FormData();
            photo.set("file", file);
            const uploaded = await submit({ url: `/api/v1/products/${created.data.id}/image`, body: photo }, { quiet: true });
            if (!uploaded.ok) {
              setPhotoMessage(`The product was saved, but the photo was not: ${uploaded.message}`);
              return;
            }
          }
          router.push("/products");
        })();
      }}
    >
      <Input name="sku" required placeholder={ph("SKU")} aria-label={ph("SKU")} />
      <Input name="name" required placeholder={ph("Name")} aria-label={ph("Name")} />
      <Input name="purchasePrice" required placeholder={ph("Purchase price")} aria-label={ph("Purchase price")} />
      <Input name="sellingPrice" required placeholder={ph("Selling price")} aria-label={ph("Selling price")} />
      <Input name="wholesalePrice" required placeholder={ph("Wholesale price")} aria-label={ph("Wholesale price")} />
      <Input name="minimumPrice" required placeholder={ph("Minimum price")} aria-label={ph("Minimum price")} />
      <Input name="reorderLevel" placeholder={ph("Reorder level")} aria-label={ph("Reorder level")} defaultValue="0" />
      <Input name="barcode" placeholder={ph("Barcode")} aria-label={ph("Barcode")} />
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
