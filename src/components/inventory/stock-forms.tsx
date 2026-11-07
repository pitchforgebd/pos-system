"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAttemptKey } from "@/lib/client/attempt-key";

type ProductOption = { id: string; label: string };

export function PrintButton() {
  return (
    <button type="button" className="h-10 rounded-md border border-border px-3 text-sm" onClick={() => window.print()}>
      Print
    </button>
  );
}

function messageFrom(body: { error?: { message?: string } }, fallback: string) {
  return body.error?.message ?? fallback;
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
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const attempt = useAttemptKey();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        setPending(true);
        setMessage("");
        void fetch(action, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": attempt.current(),
          },
          body: JSON.stringify({
            occurredOn: form.get("occurredOn"),
            lines: [
              {
                productId: form.get("productId"),
                quantity: form.get("quantity"),
                unitCost: String(form.get("unitCost") || "") || undefined,
                lot: String(form.get("lot") || "") || undefined,
                expiresOn: String(form.get("expiresOn") || "") || undefined,
              },
            ],
          }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { error?: { message?: string } };
            setMessage(response.ok ? "Saved." : messageFrom(body, "The stock was not updated."));
            if (response.ok) {
              attempt.renew();
              element.reset();
            }
          })
          .finally(() => setPending(false));
      }}
    >
      <label className="grid gap-1 text-sm">
        Product
        <select name="productId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="occurredOn" type="date" required aria-label="Date" />
      <Input name="quantity" required placeholder="Quantity" aria-label="Quantity" />
      <Input name="unitCost" placeholder="Unit cost" aria-label="Unit cost" />
      <Input name="lot" placeholder="Lot, if expiry is tracked" aria-label="Lot" />
      <Input name="expiresOn" type="date" aria-label="Expiry date" />
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={products.length === 0}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function AdjustmentForm({ products }: { products: ProductOption[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const attempt = useAttemptKey();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void fetch("/api/v1/inventory/adjustments", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": attempt.current() },
          body: JSON.stringify({
            productId: form.get("productId"),
            quantity: form.get("quantity"),
            direction: form.get("direction"),
            reason: form.get("reason"),
          }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { error?: { message?: string } };
            setMessage(response.ok ? "Saved." : messageFrom(body, "The adjustment was not saved."));
            if (response.ok) {
              attempt.renew();
              window.location.reload();
            }
          })
          .finally(() => setPending(false));
      }}
    >
      <label className="grid gap-1 text-sm">
        Product
        <select name="productId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="quantity" required placeholder="Quantity" aria-label="Quantity" />
      <label className="grid gap-1 text-sm">
        Direction
        <select name="direction" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="OUT">
          <option value="OUT">Out</option>
          <option value="IN">In</option>
        </select>
      </label>
      <Input name="reason" required placeholder="Reason" aria-label="Reason" />
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={products.length === 0}>
        Adjust stock
      </Button>
    </form>
  );
}

export function DamageForm({ products }: { products: ProductOption[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const attempt = useAttemptKey();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        setPending(true);
        setMessage("");
        void fetch("/api/v1/inventory/damage", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": attempt.current() },
          body: JSON.stringify({
            productId: form.get("productId"),
            occurredOn: form.get("occurredOn"),
            place: form.get("place"),
            lot: String(form.get("lot") || "") || undefined,
            purchasePrice: form.get("purchasePrice"),
            salePrice: form.get("salePrice"),
            discountAmount: form.get("discountAmount") || "0.00",
            vatAmount: form.get("vatAmount") || "0.00",
            quantity: form.get("quantity"),
            reason: form.get("reason"),
          }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { error?: { message?: string } };
            setMessage(response.ok ? "Saved." : messageFrom(body, "The damage record was not saved."));
            if (response.ok) {
              attempt.renew();
              element.reset();
            }
          })
          .finally(() => setPending(false));
      }}
    >
      <label className="grid gap-1 text-sm">
        Product
        <select name="productId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="occurredOn" type="date" required aria-label="Date" />
      <Input name="place" required placeholder="Place" aria-label="Place" />
      <Input name="lot" placeholder="Lot" aria-label="Lot" />
      <Input name="quantity" required placeholder="Quantity" aria-label="Quantity" />
      <Input name="purchasePrice" required placeholder="Purchase price" aria-label="Purchase price" />
      <Input name="salePrice" required placeholder="Sale price" aria-label="Sale price" />
      <Input name="discountAmount" placeholder="Discount amount" aria-label="Discount amount" defaultValue="0.00" />
      <Input name="vatAmount" placeholder="VAT amount" aria-label="VAT amount" defaultValue="0.00" />
      <Input name="reason" required placeholder="Reason" aria-label="Reason" />
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={products.length === 0}>
        Record damage
      </Button>
    </form>
  );
}

export function ExpiryWriteOffForm({ batches }: { batches: { id: string; label: string }[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const attempt = useAttemptKey();

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void fetch("/api/v1/inventory/expiry", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": attempt.current() },
          body: JSON.stringify({ batchId: form.get("batchId"), quantity: form.get("quantity") }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { error?: { message?: string } };
            setMessage(response.ok ? "Saved." : messageFrom(body, "The write-off was not saved."));
            if (response.ok) {
              attempt.renew();
              window.location.reload();
            }
          })
          .finally(() => setPending(false));
      }}
    >
      <label className="grid gap-1 text-sm">
        Lot
        <select name="batchId" required className="h-10 rounded-md border border-border bg-surface px-2">
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="quantity" required placeholder="Quantity" aria-label="Quantity" />
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={batches.length === 0}>
        Write off
      </Button>
    </form>
  );
}
