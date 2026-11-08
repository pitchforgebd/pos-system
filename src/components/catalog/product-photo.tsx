"use client";

import { useState } from "react";

import { useSubmit } from "@/lib/client/use-submit";

export function ProductPhotoForm({ productId, hasImage }: { productId: string; hasImage: boolean }) {
  const [localMessage, setLocalMessage] = useState("");
  const { submit, pending, message: serverMessage } = useSubmit();
  const message = localMessage || serverMessage;

  return (
    <form
      className="grid gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (!(data.get("file") instanceof File) || (data.get("file") as File).size === 0) {
          setLocalMessage("Choose a photo.");
          return;
        }
        setLocalMessage("");
        void submit({ url: `/api/v1/products/${productId}/image`, body: data }, { successMessage: "ছবি সংরক্ষিত হয়েছে। (Photo saved.)" });
      }}
    >
      {hasImage ? <img src={`/api/v1/products/${productId}/image`} alt="" className="size-10 rounded-md object-cover" /> : null}
      <input name="file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Product photo" className="max-w-36 text-xs" />
      <button type="submit" disabled={pending} className="text-left text-xs font-medium text-primary">
        {pending ? "Saving" : hasImage ? "Replace photo" : "Add photo"}
      </button>
      {message ? <p className="text-xs text-error">{message}</p> : null}
    </form>
  );
}
