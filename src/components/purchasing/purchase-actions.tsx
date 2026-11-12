"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import type { AccountOption } from "@/components/purchasing/purchase-form";

// What can be done to a purchase from its page, by where it is in its life: a draft is ordered, received or cancelled; an ordered purchase
// is received or cancelled; a received purchase can have goods returned. Each button is one request with its own Idempotency-Key.

export function PurchaseActions({
  id,
  status,
  today,
  accounts,
  can,
}: {
  id: string;
  status: "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED";
  today: string;
  accounts: AccountOption[];
  can: { create: boolean; edit: boolean; return: boolean };
}) {
  const { submit, pending, message } = useSubmit();
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [receivedOn, setReceivedOn] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");

  function receive() {
    const account = accounts.find((row) => row.id === accountId);
    const paying = paymentAmount.trim() !== "" && Number(paymentAmount) > 0;
    void submit(
      {
        url: `/api/v1/purchases/${id}/receive`,
        body: { receivedOn, paymentAmount: paying ? paymentAmount : undefined, paymentMethod: paying ? account?.kind : undefined, paymentAccountId: paying ? accountId : undefined },
      },
      { successMessage: "ক্রয় গ্রহণ করা হয়েছে। (Purchase received.)", onSuccess: () => setReceiving(false) },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && can.create ? (
          <Button variant="secondary" loading={pending} onClick={() => void submit({ url: `/api/v1/purchases/${id}/order`, body: {} }, { successMessage: "অর্ডার পাঠানো হয়েছে। (Order placed.)" })}>
            Order from the vendor
          </Button>
        ) : null}
        {(status === "DRAFT" || status === "ORDERED") && can.create ? <Button onClick={() => setReceiving((open) => !open)}>Receive the goods</Button> : null}
        {(status === "DRAFT" || status === "ORDERED") && can.edit ? <Button variant="secondary" href={`/purchases/${id}/edit`}>Change</Button> : null}
        {(status === "DRAFT" || status === "ORDERED") && can.edit ? (
          <Button variant="danger" onClick={() => setCancelling(true)}>
            Cancel purchase
          </Button>
        ) : null}
        {status === "RECEIVED" && can.return ? <Button variant="secondary" href="/purchases/returns">Return goods</Button> : null}
        {status !== "DRAFT" ? <Button variant="ghost" href={`/purchases/${id}/print`}>Print</Button> : null}
      </div>
      {receiving ? (
        <fieldset className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-4">
          <legend className="px-1 text-sm font-medium">The goods came</legend>
          <label className="grid gap-1 text-sm">
            Received on
            <Input type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Paid to the vendor now
            <Input inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0.00" />
          </label>
          <label className="grid gap-1 text-sm">
            Paid from
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="h-10 rounded-md border border-border bg-surface px-2">
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button loading={pending} onClick={receive}>
              Receive into stock
            </Button>
          </div>
        </fieldset>
      ) : null}
      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this purchase?"
        description="Nothing was posted for it, so nothing is undone. A cancelled purchase cannot be received."
        confirmLabel="Cancel purchase"
        tone="danger"
        onConfirm={() => void submit({ url: `/api/v1/purchases/${id}/cancel`, body: {} }, { successMessage: "ক্রয় বাতিল করা হয়েছে। (Purchase cancelled.)" })}
      />
    </div>
  );
}
