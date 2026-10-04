"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type Branch = { id: string; name: string; warehouses: { id: string; name: string }[] };
type Product = { id: string; name: string; sku: string };

export function TransferForm({ branches, products }: { branches: Branch[]; products: Product[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    void fetch("/api/v1/inventory/transfers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromBranchId: data.get("fromBranchId"),
        toBranchId: data.get("toBranchId"),
        fromWarehouseId: data.get("fromWarehouseId"),
        toWarehouseId: data.get("toWarehouseId"),
        lines: [{ productId: data.get("productId"), quantity: data.get("quantity") }],
      }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: { message?: string } };
        if (!response.ok) {
          setMessage(payload.error?.message ?? "The transfer was not posted.");
          return;
        }
        window.location.reload();
      })
      .finally(() => setPending(false));
  }

  return (
    <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
      <select name="fromBranchId" required aria-label="From branch" className="h-10 rounded-md border border-border bg-surface px-2">
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            From {branch.name}
          </option>
        ))}
      </select>
      <select name="fromWarehouseId" required aria-label="From warehouse" className="h-10 rounded-md border border-border bg-surface px-2">
        {branches.flatMap((branch) =>
          branch.warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {branch.name} / {warehouse.name}
            </option>
          )),
        )}
      </select>
      <select name="toBranchId" required aria-label="To branch" className="h-10 rounded-md border border-border bg-surface px-2">
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            To {branch.name}
          </option>
        ))}
      </select>
      <select name="toWarehouseId" required aria-label="To warehouse" className="h-10 rounded-md border border-border bg-surface px-2">
        {branches.flatMap((branch) =>
          branch.warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {branch.name} / {warehouse.name}
            </option>
          )),
        )}
      </select>
      <select name="productId" required aria-label="Product" className="h-10 rounded-md border border-border bg-surface px-2">
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.sku} {product.name}
          </option>
        ))}
      </select>
      <input name="quantity" required defaultValue="1" aria-label="Quantity" className="h-10 rounded-md border border-border px-3" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Receive transfer
      </Button>
    </form>
  );
}
