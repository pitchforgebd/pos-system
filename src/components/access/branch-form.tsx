"use client";

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

export function BranchForm() {
  const { ph } = useI18n();
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
      <Input name="name" required placeholder={ph("Branch name")} aria-label={ph("Branch name")} />
      <Input name="phone" placeholder={ph("Phone")} aria-label={ph("Phone")} />
      <Input name="address" placeholder={ph("Address")} aria-label={ph("Address")} />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Create branch")}
      </Button>
    </form>
  );
}
