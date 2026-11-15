"use client";

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

type Branch = { id: string; name: string; warehouses: { id: string; name: string }[] };
type Product = { id: string; name: string; sku: string };

export function TransferForm({ branches, products }: { branches: Branch[]; products: Product[] }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit({
      url: "/api/v1/inventory/transfers",
      body: {
        fromBranchId: data.get("fromBranchId"),
        toBranchId: data.get("toBranchId"),
        fromWarehouseId: data.get("fromWarehouseId"),
        toWarehouseId: data.get("toWarehouseId"),
        lines: [{ productId: data.get("productId"), quantity: data.get("quantity") }],
      },
    });
  }

  return (
    <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
      <select name="fromBranchId" required aria-label={ph("From branch")} className="h-10 rounded-md border border-border bg-surface px-2">
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {ph("From")} {branch.name}
          </option>
        ))}
      </select>
      <select name="fromWarehouseId" required aria-label={ph("From warehouse")} className="h-10 rounded-md border border-border bg-surface px-2">
        {branches.flatMap((branch) =>
          branch.warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {branch.name} / {warehouse.name}
            </option>
          )),
        )}
      </select>
      <select name="toBranchId" required aria-label={ph("To branch")} className="h-10 rounded-md border border-border bg-surface px-2">
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {ph("To")} {branch.name}
          </option>
        ))}
      </select>
      <select name="toWarehouseId" required aria-label={ph("To warehouse")} className="h-10 rounded-md border border-border bg-surface px-2">
        {branches.flatMap((branch) =>
          branch.warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {branch.name} / {warehouse.name}
            </option>
          )),
        )}
      </select>
      <select name="productId" required aria-label={ph("Product")} className="h-10 rounded-md border border-border bg-surface px-2">
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.sku} {product.name}
          </option>
        ))}
      </select>
      <input name="quantity" required defaultValue="1" aria-label={ph("Quantity")} className="h-10 rounded-md border border-border px-3" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Receive transfer")}
      </Button>
    </form>
  );
}
