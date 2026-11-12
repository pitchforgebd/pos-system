"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Status = "CREATED" | "PICKED" | "IN_TRANSIT" | "DELIVERED" | "RETURNED" | "LOST";

// A parcel's way: picked up, on the road, delivered, lost; or back (the cash is given back, the whole sale is returned). Each is one request.
export function ShipmentActions({ id, status, method, today, can }: { id: string; status: Status; method: "COURIER" | "OWN_VEHICLE" | "PICKUP"; today: string; can: boolean }) {
  const { submit, pending, message } = useSubmit();
  const [returning, setReturning] = useState(false);
  const [charge, setCharge] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);
  if (!can || status === "DELIVERED" || status === "RETURNED" || status === "LOST") {
    return null;
  }
  const step = (action: string, success: string) => void submit({ url: `/api/v1/shipments/${id}/${action}`, body: {} }, { successMessage: success });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "CREATED" ? <Button variant="secondary" loading={pending} onClick={() => step("picked", "পার্সেল তোলা হয়েছে। (Picked up.)")}>Picked up</Button> : null}
        {status === "CREATED" || status === "PICKED" ? <Button variant="secondary" loading={pending} onClick={() => step("in-transit", "পথে আছে। (In transit.)")}>On the way</Button> : null}
        <Button loading={pending} onClick={() => step("delivered", "পার্সেল ডেলিভারি হয়েছে। (Delivered.)")}>Delivered</Button>
        <Button variant="secondary" loading={pending} onClick={() => step("lost", "হারিয়ে গেছে। (Marked lost.)")}>Lost</Button>
        {method === "COURIER" ? <Button variant="danger" onClick={() => setReturning((open) => !open)}>Came back</Button> : null}
      </div>
      {returning ? (
        <fieldset className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-4">
          <legend className="px-1 text-sm font-medium">The parcel came back: the whole sale is returned and the courier no longer owes the cash</legend>
          <label className="grid gap-1 text-sm">
            Date
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Return charge (the way back)
            <Input inputMode="decimal" value={charge} onChange={(event) => setCharge(event.target.value)} placeholder="0.00" />
          </label>
          <label className="grid gap-1 text-sm">
            Why
            <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} />
          </label>
          <div className="flex items-end">
            <Button
              variant="danger"
              loading={pending}
              onClick={() => void submit({ url: `/api/v1/shipments/${id}/return`, body: { businessDate: date, returnCharge: charge.trim() === "" ? undefined : charge, reason: reason.trim() === "" ? undefined : reason } }, { successMessage: "পার্সেল ফেরত, সেল রিটার্ন হয়েছে। (Parcel returned.)" })}
            >
              Return the parcel
            </Button>
          </div>
        </fieldset>
      ) : null}
      {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
    </div>
  );
}
