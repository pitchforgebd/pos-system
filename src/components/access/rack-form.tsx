"use client";

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

export function RackForm({ warehouses }: { warehouses: { id: string; name: string }[] }) {
  const { submit, pending, message } = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit({ url: "/api/v1/racks", body: { warehouseId: data.get("warehouseId"), name: data.get("name") } });
  }

  return (
    <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
      <select name="warehouseId" required aria-label="Warehouse" className="h-10 rounded-md border border-border bg-surface px-2">
        {warehouses.map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.name}
          </option>
        ))}
      </select>
      <Input name="name" required placeholder="Rack name" aria-label="Rack name" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Create rack
      </Button>
    </form>
  );
}
