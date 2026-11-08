"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

export function SupplierForm() {
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit(
          {
            url: "/api/v1/suppliers",
            body: {
              name: form.get("name"),
              phone: String(form.get("phone") || "") || null,
              email: String(form.get("email") || "") || null,
              address: String(form.get("address") || "") || null,
              openingPayable: form.get("openingPayable") || "0.00",
              creditLimit: String(form.get("creditLimit") || "") || null,
              paymentTerms: String(form.get("paymentTerms") || "") || null,
            },
          },
          { goTo: "/suppliers" },
        );
      }}
    >
      <Input name="name" required placeholder="Name" aria-label="Name" />
      <Input name="phone" placeholder="Phone" aria-label="Phone" />
      <Input name="email" type="email" placeholder="Email" aria-label="Email" />
      <Input name="address" placeholder="Address" aria-label="Address" />
      <Input name="openingPayable" placeholder="Opening payable" aria-label="Opening payable" defaultValue="0.00" />
      <Input name="creditLimit" placeholder="Credit limit" aria-label="Credit limit" />
      <Input name="paymentTerms" placeholder="Payment terms" aria-label="Payment terms" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save supplier
      </Button>
    </form>
  );
}
