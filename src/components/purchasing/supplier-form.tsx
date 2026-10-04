"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SupplierForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void fetch("/api/v1/suppliers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.get("name"),
            phone: String(form.get("phone") || "") || null,
            email: String(form.get("email") || "") || null,
            address: String(form.get("address") || "") || null,
            openingPayable: form.get("openingPayable") || "0.00",
            creditLimit: String(form.get("creditLimit") || "") || null,
            paymentTerms: String(form.get("paymentTerms") || "") || null,
          }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { error?: { message?: string } };
            if (!response.ok) {
              setMessage(body.error?.message ?? "The supplier was not saved.");
              return;
            }
            window.location.replace("/suppliers");
          })
          .finally(() => setPending(false));
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
