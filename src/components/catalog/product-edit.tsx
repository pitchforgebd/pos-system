"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Option = { id: string; name: string };

export type EditableProduct = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  genericName: string | null;
  brandId: string | null;
  categoryId: string | null;
  unitId: string | null;
  vatType: string | null;
  vatValue: string | null;
  sellingPrice: string;
  wholesalePrice: string;
  minimumPrice: string;
  reorderLevel: string;
  isService: boolean;
  trackStock: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  warrantyAvailable: boolean;
  /** Only for someone who may see what the product cost. */
  purchasePrice?: string;
};

function Select({ name, label, value, options, none }: { name: string; label: string; value: string | null; options: Option[]; none: string }) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <select name={name} defaultValue={value ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
        <option value="">{none}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The general information of a product: name, groups, VAT, prices, flags. */
export function ProductEditForm({ product, brands, categories, units }: { product: EditableProduct; brands: Option[]; categories: Option[]; units: Option[] }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-2xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const text = (name: string) => String(form.get(name) ?? "").trim();
        const flag = (name: string) => form.get(name) === "on";
        void submit(
          {
            url: `/api/v1/products/${product.id}`,
            method: "PATCH",
            body: {
              sku: text("sku"),
              name: text("name"),
              description: text("description") || null,
              genericName: text("genericName") || null,
              brandId: text("brandId") || null,
              categoryId: text("categoryId") || null,
              unitId: text("unitId") || null,
              ...(product.purchasePrice !== undefined ? { purchasePrice: text("purchasePrice") } : {}),
              sellingPrice: text("sellingPrice"),
              wholesalePrice: text("wholesalePrice"),
              minimumPrice: text("minimumPrice"),
              vatType: text("vatType") || null,
              vatValue: text("vatValue") || null,
              reorderLevel: text("reorderLevel") || "0",
              isService: flag("isService"),
              trackStock: flag("trackStock"),
              trackExpiry: flag("trackExpiry"),
              trackSerial: flag("trackSerial"),
              warrantyAvailable: flag("warrantyAvailable"),
            },
          },
          { successMessage: "Saved." },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="sku" required defaultValue={product.sku} aria-label="SKU" placeholder="SKU" />
        <Input name="name" required defaultValue={product.name} aria-label="Name" placeholder="Name" />
        <Input name="genericName" defaultValue={product.genericName ?? ""} aria-label="Generic name" placeholder="Generic name" />
        <Input name="reorderLevel" defaultValue={product.reorderLevel} aria-label="Reorder level" placeholder="Reorder level" />
        <Select name="brandId" label="Brand" value={product.brandId} options={brands} none="No brand" />
        <Select name="categoryId" label="Category" value={product.categoryId} options={categories} none="No category" />
        <Select name="unitId" label="Unit" value={product.unitId} options={units} none="No unit" />
        <label className="grid gap-1 text-sm">
          VAT
          <select name="vatType" defaultValue={product.vatType ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">No VAT</option>
            <option value="INCLUSIVE">Included in the price</option>
            <option value="EXCLUSIVE">Added to the price</option>
          </select>
        </label>
        <Input name="vatValue" defaultValue={product.vatValue ?? ""} aria-label="VAT rate in percent" placeholder="VAT rate, %" />
      </div>
      <label className="grid gap-1 text-sm">
        Description
        <textarea name="description" defaultValue={product.description ?? ""} rows={3} className="rounded-md border border-border bg-surface px-3 py-2" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="sellingPrice" required defaultValue={product.sellingPrice} aria-label="Retail price" placeholder="Retail price" />
        <Input name="wholesalePrice" required defaultValue={product.wholesalePrice} aria-label="Wholesale price" placeholder="Wholesale price" />
        <Input name="minimumPrice" required defaultValue={product.minimumPrice} aria-label="Minimum price" placeholder="Minimum price" />
        {product.purchasePrice !== undefined ? <Input name="purchasePrice" required defaultValue={product.purchasePrice} aria-label="Last purchase price" placeholder="Last purchase price" /> : null}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {(
          [
            ["isService", "A service (no stock)", product.isService],
            ["trackStock", "Track stock", product.trackStock],
            ["trackExpiry", "Track expiry (lots)", product.trackExpiry],
            ["trackSerial", "Track IMEI / serial", product.trackSerial],
            ["warrantyAvailable", "Has warranty", product.warrantyAvailable],
          ] as const
        ).map(([name, label, checked]) => (
          <label key={name} className="flex items-center gap-2">
            <input name={name} type="checkbox" defaultChecked={checked} />
            {label}
          </label>
        ))}
      </div>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save product
      </Button>
    </form>
  );
}

type Step = { level: string; minQty: string; price: string };

/** The price list: a level, the quantity a price starts at, the price. The default level is the fallback for everything else. */
export function PriceStepsForm({ productId, levels, initial }: { productId: string; levels: string[]; initial: Step[] }) {
  const { submit, pending, message } = useSubmit();
  const [rows, setRows] = useState<Step[]>(initial.length > 0 ? initial : [{ level: levels[0] ?? "Retail", minQty: "1", price: "" }]);
  const change = (index: number, patch: Partial<Step>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <form
      className="grid max-w-2xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ url: `/api/v1/products/${productId}/prices`, method: "PUT", body: { prices: rows.map((row) => ({ level: row.level, minQty: row.minQty.trim(), price: row.price.trim() })) } }, { successMessage: "Prices saved." });
      }}
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="py-1 pr-2">Level</th>
            <th className="py-1 pr-2">From quantity</th>
            <th className="py-1 pr-2">Price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td className="py-1 pr-2">
                <select aria-label="Level" value={row.level} onChange={(event) => change(index, { level: event.target.value })} className="h-10 rounded-md border border-border bg-surface px-2">
                  {levels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1 pr-2">
                <Input aria-label="From quantity" value={row.minQty} onChange={(event) => change(index, { minQty: event.target.value })} />
              </td>
              <td className="py-1 pr-2">
                <Input aria-label="Price" value={row.price} onChange={(event) => change(index, { price: event.target.value })} />
              </td>
              <td className="py-1">
                <button type="button" className="text-sm underline" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => setRows((current) => [...current, { level: levels[0] ?? "Retail", minQty: "1", price: "" }])}>
          Add a step
        </Button>
        <Button type="submit" loading={pending}>
          Save prices
        </Button>
      </div>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}

/** Adds one more barcode to the product (or to one variant of it). */
export function BarcodeAddForm({ productId }: { productId: string }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="flex max-w-md flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const barcode = String(new FormData(element).get("barcode") ?? "").trim();
        void submit({ url: `/api/v1/products/${productId}/barcodes`, body: { barcode } }, { onSuccess: () => element.reset() });
      }}
    >
      <Input name="barcode" required placeholder="Barcode" aria-label="Barcode" />
      <Button type="submit" variant="secondary" loading={pending}>
        Add barcode
      </Button>
      <Button type="button" variant="secondary" loading={pending} onClick={() => void submit({ url: `/api/v1/products/${productId}/barcodes`, body: { generate: true } }, { successMessage: "Barcode made." })}>
        Make one (EAN-13)
      </Button>
      {message ? <p className="w-full text-sm text-error">{message}</p> : null}
    </form>
  );
}

/** Adds a variant (a size, a pack) with its own SKU, one value of each variation it uses and, if it differs, its own price. */
export function VariantAddForm({ productId, heads }: { productId: string; heads: Array<{ id: string; name: string; values: Array<{ id: string; value: string }> }> }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="flex max-w-xl flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        const price = String(form.get("price") ?? "").trim();
        const values = heads.flatMap((head) => {
          const valueId = String(form.get(`head-${head.id}`) ?? "");
          return valueId ? [{ headId: head.id, valueId }] : [];
        });
        void submit({ url: `/api/v1/products/${productId}/variants`, body: { sku: String(form.get("sku") ?? "").trim(), ...(price ? { price } : {}), ...(values.length > 0 ? { values } : {}) } }, { onSuccess: () => element.reset() });
      }}
    >
      <Input name="sku" required placeholder="Variant SKU" aria-label="Variant SKU" />
      {heads.map((head) => (
        <label key={head.id} className="grid gap-1 text-sm">
          {head.name}
          <select name={`head-${head.id}`} defaultValue="" className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">—</option>
            {head.values.map((value) => (
              <option key={value.id} value={value.id}>
                {value.value}
              </option>
            ))}
          </select>
        </label>
      ))}
      <Input name="price" placeholder="Price (optional)" aria-label="Variant price" />
      <Button type="submit" variant="secondary" loading={pending}>
        Add variant
      </Button>
      {message ? <p className="w-full text-sm text-error">{message}</p> : null}
    </form>
  );
}
