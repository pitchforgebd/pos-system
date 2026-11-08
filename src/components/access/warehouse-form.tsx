"use client";

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

export function WarehouseForm({ branches }: { branches: { id: string; name: string }[] }) {
  const { submit, pending, message } = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit({ url: "/api/v1/warehouses", body: { branchId: data.get("branchId"), name: data.get("name") } });
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
