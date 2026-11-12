"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Status = "DRAFT" | "CONFIRMED" | "PACKED" | "DISPATCHED" | "DELIVERED" | "CANCELLED" | "RETURNED";

// What can be done to an order from its page, by where it is in its life. Each button is one request with its own Idempotency-Key.
type Courier = { id: string; name: string; defaultConditionPercent: string; defaultDeliveryCharge: string; outsideDeliveryCharge: string };

export function OrderActions({
  id,
  status,
  today,
  advance,
  can,
  deliveryMethod,
  couriers,
  shipment,
}: {
  id: string;
  status: Status;
  today: string;
  advance: string;
  can: { create: boolean; manage: boolean };
  deliveryMethod: "PICKUP" | "OWN_VEHICLE" | "COURIER";
  couriers: Courier[];
  shipment: { id: string; number: string | null; status: string; method: string } | null;
}) {
  const { submit, pending, message } = useSubmit();
  const [dispatching, setDispatching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [date, setDate] = useState(today);
  const [fromAdvance, setFromAdvance] = useState("");
  const [courierId, setCourierId] = useState(couriers[0]?.id ?? "");
  const [tracking, setTracking] = useState("");
  const [outside, setOutside] = useState(false);
  const [deliveryCharge, setDeliveryCharge] = useState("");
  const [conditionPercent, setConditionPercent] = useState("");
  const [paidWith, setPaidWith] = useState<"DEDUCT" | "CASH" | "BANK">(deliveryMethod === "COURIER" ? "DEDUCT" : "CASH");
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const courier = couriers.find((row) => row.id === courierId);
  const step = (action: string, success: string) => void submit({ url: `/api/v1/orders/${id}/${action}`, body: {} }, { successMessage: success });

  function dispatch() {
    const wallet = fromAdvance.trim() !== "" && Number(fromAdvance) > 0;
    void submit(
      {
        url: `/api/v1/orders/${id}/dispatch`,
        body: {
          dispatchedOn: date,
          tenders: wallet ? [{ method: "WALLET", amount: fromAdvance }] : undefined,
          shipment:
            deliveryMethod === "COURIER"
              ? { courierId, trackingCode: tracking.trim() || undefined, outsideDhaka: outside, deliveryCharge: deliveryCharge.trim() || undefined, conditionPercent: conditionPercent.trim() || undefined, deliveryPaidWith: paidWith }
              : deliveryMethod === "OWN_VEHICLE"
                ? { vehicleNo: vehicleNo.trim() || undefined, driverName: driverName.trim() || undefined, driverPhone: driverPhone.trim() || undefined, deliveryCharge: deliveryCharge.trim() || undefined, deliveryPaidWith: paidWith === "BANK" ? "BANK" : "CASH" }
                : undefined,
        },
      },
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
        {status === "DISPATCHED" && can.manage && shipment?.method === "COURIER" ? <Button variant="secondary" href={`/shipments/${shipment.id}`}>Parcel {shipment.number} ({shipment.status.toLowerCase().replace("_", " ")})</Button> : null}
        {status === "DISPATCHED" && can.manage && shipment?.method !== "COURIER" ? <Button loading={pending} onClick={() => step("deliver", "ডেলিভারি হয়েছে। (Delivered.)")}>Mark delivered</Button> : null}
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
          {deliveryMethod === "COURIER" ? (
            <>
              <label className="grid gap-1 text-sm">
                Courier
                <select value={courierId} onChange={(event) => setCourierId(event.target.value)} className="h-10 rounded-md border border-border bg-surface px-2">
                  {couriers.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                Tracking code
                <Input value={tracking} onChange={(event) => setTracking(event.target.value)} maxLength={64} />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={outside} onChange={(event) => setOutside(event.target.checked)} />
                Outside Dhaka
              </label>
              <label className="grid gap-1 text-sm">
                Delivery charge (default {courier ? (outside ? courier.outsideDeliveryCharge : courier.defaultDeliveryCharge) : "-"})
                <Input inputMode="decimal" value={deliveryCharge} onChange={(event) => setDeliveryCharge(event.target.value)} placeholder="the courier's" />
              </label>
              <label className="grid gap-1 text-sm">
                Condition % (default {courier?.defaultConditionPercent ?? "-"})
                <Input inputMode="decimal" value={conditionPercent} onChange={(event) => setConditionPercent(event.target.value)} placeholder="the courier's" />
              </label>
              <label className="grid gap-1 text-sm">
                The delivery charge is
                <select value={paidWith} onChange={(event) => setPaidWith(event.target.value as "DEDUCT" | "CASH" | "BANK")} className="h-10 rounded-md border border-border bg-surface px-2">
                  <option value="DEDUCT">Kept out of the settlement</option>
                  <option value="CASH">Paid now in cash</option>
                  <option value="BANK">Paid now by bank</option>
                </select>
              </label>
              <p className="text-sm text-muted md:col-span-3">The courier collects what the customer still owes on the invoice and owes it to the shop until it settles.</p>
            </>
          ) : null}
          {deliveryMethod === "OWN_VEHICLE" ? (
            <>
              <label className="grid gap-1 text-sm">
                Vehicle no.
                <Input value={vehicleNo} onChange={(event) => setVehicleNo(event.target.value)} maxLength={32} />
              </label>
              <label className="grid gap-1 text-sm">
                Driver
                <Input value={driverName} onChange={(event) => setDriverName(event.target.value)} maxLength={191} />
              </label>
              <label className="grid gap-1 text-sm">
                Driver&apos;s phone
                <Input value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} maxLength={32} />
              </label>
              <label className="grid gap-1 text-sm">
                Fare
                <Input inputMode="decimal" value={deliveryCharge} onChange={(event) => setDeliveryCharge(event.target.value)} placeholder="0.00" />
              </label>
              <label className="grid gap-1 text-sm">
                Paid
                <select value={paidWith === "BANK" ? "BANK" : "CASH"} onChange={(event) => setPaidWith(event.target.value as "CASH" | "BANK")} className="h-10 rounded-md border border-border bg-surface px-2">
                  <option value="CASH">In cash</option>
                  <option value="BANK">By bank</option>
                </select>
              </label>
            </>
          ) : null}
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
