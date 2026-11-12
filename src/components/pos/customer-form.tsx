"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

export function CustomerForm() {
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        void submit(
          { url: "/api/v1/customers", body: { name: form.get("name"), creditLimit: String(form.get("creditLimit") || "") || undefined } },
          { successMessage: "কাস্টমার যোগ হয়েছে। (Customer added.)", onSuccess: () => element.reset() },
        );
      }}
    >
      <Input name="name" required placeholder="Customer name" aria-label="Customer name" />
      <Input name="creditLimit" placeholder="Credit limit" aria-label="Credit limit" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" variant="secondary" loading={pending}>
        Add customer
      </Button>
    </form>
  );
}
