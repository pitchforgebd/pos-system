"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NamedRecordForm({ action, label }: { action: string; label: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="flex max-w-md flex-col gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void fetch(action, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: form.get("name") }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { error?: { message?: string } };
            if (!response.ok) {
              setMessage(body.error?.message ?? "That record was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
      }}
    >
      <Input name="name" required placeholder={label} aria-label={label} />
      <Button type="submit" loading={pending}>
        Add
      </Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}
