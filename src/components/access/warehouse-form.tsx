"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WarehouseForm({ branches }: { branches: { id: string; name: string }[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    void fetch("/api/v1/warehouses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branchId: data.get("branchId"), name: data.get("name") }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: { message?: string } };
        if (!response.ok) {
          setMessage(payload.error?.message ?? "The warehouse was not created.");
          return;
        }
        window.location.reload();
      })
      .finally(() => setPending(false));
  }

  return (
    <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
      <select name="branchId" required aria-label="Branch" className="h-10 rounded-md border border-border bg-surface px-2">
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
      <Input name="name" required placeholder="Warehouse name" aria-label="Warehouse name" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Create warehouse
      </Button>
    </form>
  );
}
