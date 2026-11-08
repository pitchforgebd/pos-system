"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

export function ProductForm() {
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
