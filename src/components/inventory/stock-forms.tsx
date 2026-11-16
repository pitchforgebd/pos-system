"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

type ProductOption = { id: string; label: string };

export function PrintButton() {
  const { ph } = useI18n();
  return (
    <button type="button" className="h-10 rounded-md border border-border px-3 text-sm" onClick={() => window.print()}>
      {ph("Print")}
    </button>
  );
}

export function InboundForm({
  action,
  products,
  submitLabel,
}: {
  action: string;
  products: ProductOption[];
  submitLabel: string;
}) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        void submit(
          {
            url: action,
            body: {
              businessDate: form.get("businessDate"),
              lines: [
                {
                  productId: form.get("productId"),
                  quantity: form.get("quantity"),
                  unitCost: String(form.get("unitCost") || "") || undefined,
                  lot: String(form.get("lot") || "") || undefined,
                  expiresOn: String(form.get("expiresOn") || "") || undefined,
                },
              ],
            },
          },
          { onSuccess: () => element.reset() },
        );
      }}
    >
      <label className="grid gap-1 text-sm">
        {ph("Product")}
        <select name="productId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="businessDate" type="date" required aria-label={ph("Date")} />
      <Input name="quantity" required placeholder={ph("Quantity")} aria-label={ph("Quantity")} />
      <Input name="unitCost" placeholder={ph("Unit cost")} aria-label={ph("Unit cost")} />
      <Input name="lot" placeholder={ph("Lot, if expiry is tracked")} aria-label={ph("Lot")} />
      <Input name="expiresOn" type="date" aria-label={ph("Expiry date")} />
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={products.length === 0}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function AdjustmentForm({ products }: { products: ProductOption[] }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/inventory/adjustments",
          body: {
            productId: form.get("productId"),
            quantity: form.get("quantity"),
            direction: form.get("direction"),
            reason: form.get("reason"),
            ...(form.get("businessDate") ? { businessDate: form.get("businessDate") } : {}),
          },
        });
      }}
    >
      <label className="grid gap-1 text-sm">
        {ph("Product")}
        <select name="productId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="quantity" required placeholder={ph("Quantity")} aria-label={ph("Quantity")} />
      <label className="grid gap-1 text-sm">
        {ph("Direction")}
        <select name="direction" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="OUT">
          <option value="OUT">{ph("Out")}</option>
          <option value="IN">{ph("In")}</option>
        </select>
      </label>
      <Input name="reason" required placeholder={ph("Reason")} aria-label={ph("Reason")} />
      <label className="grid gap-1 text-sm">
        {ph("Day of the count")}
        <Input name="businessDate" type="date" aria-label={ph("Day of the count")} />
      </label>
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={products.length === 0}>
        {ph("Adjust stock")}
      </Button>
    </form>
  );
}

export function DamageForm({ products }: { products: ProductOption[] }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        void submit(
          {
            url: "/api/v1/inventory/damage",
            body: {
              productId: form.get("productId"),
              businessDate: form.get("businessDate"),
              place: form.get("place"),
              lot: String(form.get("lot") || "") || undefined,
              purchasePrice: form.get("purchasePrice"),
              salePrice: form.get("salePrice"),
              discountAmount: form.get("discountAmount") || "0.00",
              vatAmount: form.get("vatAmount") || "0.00",
              quantity: form.get("quantity"),
              reason: form.get("reason"),
            },
          },
          { onSuccess: () => element.reset() },
        );
      }}
    >
      <label className="grid gap-1 text-sm">
        {ph("Product")}
        <select name="productId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="businessDate" type="date" required aria-label={ph("Date")} />
      <Input name="place" required placeholder={ph("Place")} aria-label={ph("Place")} />
      <Input name="lot" placeholder={ph("Lot")} aria-label={ph("Lot")} />
      <Input name="quantity" required placeholder={ph("Quantity")} aria-label={ph("Quantity")} />
      <Input name="purchasePrice" required placeholder={ph("Purchase price")} aria-label={ph("Purchase price")} />
      <Input name="salePrice" required placeholder={ph("Sale price")} aria-label={ph("Sale price")} />
      <Input name="discountAmount" placeholder={ph("Discount amount")} aria-label={ph("Discount amount")} defaultValue="0.00" />
      <Input name="vatAmount" placeholder={ph("VAT amount")} aria-label={ph("VAT amount")} defaultValue="0.00" />
      <Input name="reason" required placeholder={ph("Reason")} aria-label={ph("Reason")} />
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={products.length === 0}>
        {ph("Record damage")}
      </Button>
    </form>
  );
}

export function ExpiryWriteOffForm({ batches }: { batches: { id: string; label: string }[] }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/inventory/expiry",
          body: { batchId: form.get("batchId"), quantity: form.get("quantity") },
        });
      }}
    >
      <label className="grid gap-1 text-sm">
        {ph("Lot")}
        <select name="batchId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="quantity" required placeholder={ph("Quantity")} aria-label={ph("Quantity")} />
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={batches.length === 0}>
        {ph("Write off")}
      </Button>
    </form>
  );
}

const PURPOSES = [
  ["SAMPLE", "Sample for a customer"],
  ["DEMO", "Demonstration"],
  ["FIELD_TRIAL", "Field trial"],
  ["OWN_USE", "Owner's own use (a drawing)"],
  ["GIFT", "Gift"],
] as const;

/** Take-off: goods leave the warehouse without a sale. The owner's own use is a drawing; the other reasons are an expense. */
export function TakeOffForm({ products }: { products: ProductOption[] }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        const text = (name: string) => String(form.get(name) || "").trim() || undefined;
        void submit(
          {
            url: "/api/v1/inventory/take-off",
            body: {
              businessDate: form.get("businessDate"),
              purpose: form.get("purpose"),
              recipient: form.get("recipient"),
              approvedBy: form.get("approvedBy"),
              note: text("note"),
              lines: [{ productId: form.get("productId"), quantity: form.get("quantity"), lot: text("lot") }],
            },
          },
          { onSuccess: () => element.reset() },
        );
      }}
    >
      <Input name="businessDate" type="date" required aria-label={ph("Date")} />
      <label className="grid gap-1 text-sm">
        {ph("Product")}
        <select name="productId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="quantity" required placeholder={ph("Quantity")} aria-label={ph("Quantity")} />
      <Input name="lot" placeholder={ph("Lot (for an expiry-tracked product)")} aria-label={ph("Lot")} />
      <label className="grid gap-1 text-sm">
        {ph("Why")}
        <select name="purpose" required className="h-10 rounded-md border border-border bg-surface px-2">
          {PURPOSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Input name="recipient" required placeholder={ph("Given to")} aria-label={ph("Given to")} />
      <Input name="approvedBy" required placeholder={ph("Approved by")} aria-label={ph("Approved by")} />
      <Input name="note" placeholder={ph("Note")} aria-label={ph("Note")} />
      <p className="text-sm text-muted">{ph("The goods leave stock at their average cost. Nothing is sold and no customer is charged.")}</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Save take-off")}
      </Button>
    </form>
  );
}
