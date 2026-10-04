"use client";

import { useState } from "react";

export function ProductPhotoForm({ productId, hasImage }: { productId: string; hasImage: boolean }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (!(data.get("file") instanceof File) || (data.get("file") as File).size === 0) {
          setMessage("Choose a photo.");
          return;
        }
        setPending(true);
        setMessage("");
        void fetch(`/api/v1/products/${productId}/image`, { method: "POST", body: data })
          .then(async (response) => {
            const payload = (await response.json()) as { error?: { message?: string } };
            if (!response.ok) {
              setMessage(payload.error?.message ?? "The photo was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
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
