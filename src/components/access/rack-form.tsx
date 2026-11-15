"use client";

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

export function RackForm({ warehouses }: { warehouses: { id: string; name: string }[] }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit({ url: "/api/v1/racks", body: { warehouseId: data.get("warehouseId"), name: data.get("name") } });
  }

  return (
    <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
      <select name="warehouseId" required aria-label={ph("Warehouse")} className="h-10 rounded-md border border-border bg-surface px-2">
        {warehouses.map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.name}
          </option>
        ))}
      </select>
      <Input name="name" required placeholder={ph("Rack name")} aria-label={ph("Rack name")} />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Create rack")}
      </Button>
    </form>
  );
}
