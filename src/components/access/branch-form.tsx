"use client";

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

export function BranchForm() {
  const { submit, pending, message } = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit({
      url: "/api/v1/branches",
      body: {
        name: data.get("name"),
        phone: String(data.get("phone") || "") || null,
        address: String(data.get("address") || "") || null,
      },
    });
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
