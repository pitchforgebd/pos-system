"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Status = "DRAFT" | "CONFIRMED" | "PACKED" | "DISPATCHED" | "DELIVERED" | "CANCELLED" | "RETURNED";

// What can be done to an order from its page, by where it is in its life. Each button is one request with its own Idempotency-Key.
export function OrderActions({ id, status, today, advance, can }: { id: string; status: Status; today: string; advance: string; can: { create: boolean; manage: boolean } }) {
  const { submit, pending, message } = useSubmit();
  const [dispatching, setDispatching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [date, setDate] = useState(today);
  const [fromAdvance, setFromAdvance] = useState("");
  const step = (action: string, success: string) => void submit({ url: `/api/v1/orders/${id}/${action}`, body: {} }, { successMessage: success });

  function dispatch() {
    const wallet = fromAdvance.trim() !== "" && Number(fromAdvance) > 0;
    void submit(
      { url: `/api/v1/orders/${id}/dispatch`, body: { dispatchedOn: date, tenders: wallet ? [{ method: "WALLET", amount: fromAdvance }] : undefined } },
      { successMessage: "অর্ডার পাঠানো হয়েছে, ইনভয়েস তৈরি। (Dispatched, invoice made.)", onSuccess: () => setDispatching(false) },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && can.manage ? <Button loading={pending} onClick={() => step("confirm", "অর্ডার নিশ্চিত হয়েছে। (Confirmed: the stock is held.)")}>Confirm (reserve the stock)</Button> : null}
        {status === "DRAFT" && can.create ? <Button variant="secondary" href={`/orders/${id}/edit`}>Change</Button> : null}
        {status === "CONFIRMED" && can.manage ? <Button variant="secondary" loading={pending} onClick={() => step("pack", "প্যাক করা হয়েছে। (Packed.)")}>Mark packed</Button> : null}
        {(status === "CONFIRMED" || status === "PACKED") && can.manage ? <Button onClick={() => setDispatching((open) => !open)}>Dispatch (make the invoice)</Button> : null}
        {status === "DISPATCHED" && can.manage ? <Button loading={pending} onClick={() => step("deliver", "ডেলিভারি হয়েছে। (Delivered.)")}>Mark delivered</Button> : null}
        {(status === "DRAFT" || status === "CONFIRMED" || status === "PACKED") && can.manage ? <Button variant="danger" onClick={() => setCancelling(true)}>Cancel order</Button> : null}
        {status === "DISPATCHED" || status === "DELIVERED" ? <Button variant="secondary" href="/sales/returns">Return goods</Button> : null}
        <Button variant="ghost" href={`/orders/${id}/print`}>Print</Button>
      </div>
      {dispatching ? (
        <fieldset className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-3">
          <legend className="px-1 text-sm font-medium">Dispatch: the invoice posts and the stock goes out</legend>
          <label className="grid gap-1 text-sm">
            Dispatched on
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Paid now from the customer&apos;s advance (they hold {advance})
            <Input inputMode="decimal" value={fromAdvance} onChange={(event) => setFromAdvance(event.target.value)} placeholder="0.00" />
          </label>
          <div className="flex items-end">
            <Button loading={pending} onClick={dispatch}>
              Dispatch
            </Button>
          </div>
        </fieldset>
      ) : null}
      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this order?"
        description="What it was holding in stock is released. After a dispatch an order can only be undone by a return."
        confirmLabel="Cancel order"
        tone="danger"
        onConfirm={() => step("cancel", "অর্ডার বাতিল। (Order cancelled.)")}
      />
    </div>
  );
}
