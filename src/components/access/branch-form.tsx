"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BranchForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    void fetch("/api/v1/branches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        phone: String(data.get("phone") || "") || null,
        address: String(data.get("address") || "") || null,
      }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: { message?: string } };
        if (!response.ok) {
          setMessage(payload.error?.message ?? "The branch was not created.");
          return;
        }
        window.location.reload();
      })
      .finally(() => setPending(false));
  }

  return (
    <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
      <Input name="name" required placeholder="Branch name" aria-label="Branch name" />
      <Input name="phone" placeholder="Phone" aria-label="Phone" />
      <Input name="address" placeholder="Address" aria-label="Address" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Create branch
      </Button>
    </form>
  );
}
