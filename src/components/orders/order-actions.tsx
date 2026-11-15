"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

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
  /** The customer's advance, already written as taka. */
  advance: string;
  can: { create: boolean; manage: boolean };
  deliveryMethod: "PICKUP" | "OWN_VEHICLE" | "COURIER";
  couriers: Courier[];
  shipment: { id: string; number: string | null; status: string; method: string } | null;
}) {
  const { t, taka } = useI18n();
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
  const field = "h-10 rounded-md border border-border bg-surface px-2";

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
      { successMessage: t("orders.dispatched"), onSuccess: () => setDispatching(false) },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && can.manage ? (
          <Button loading={pending} onClick={() => step("confirm", t("orders.confirmed"))}>
            {t("orders.confirm")}
          </Button>
        ) : null}
        {status === "DRAFT" && can.create ? (
          <Button variant="secondary" href={`/orders/${id}/edit`}>
            {t("orders.change")}
          </Button>
        ) : null}
        {status === "CONFIRMED" && can.manage ? (
          <Button variant="secondary" loading={pending} onClick={() => step("pack", t("orders.packed"))}>
            {t("orders.pack")}
          </Button>
        ) : null}
        {(status === "CONFIRMED" || status === "PACKED") && can.manage ? <Button onClick={() => setDispatching((open) => !open)}>{t("orders.dispatch")}</Button> : null}
        {status === "DISPATCHED" && can.manage && shipment?.method === "COURIER" ? (
          <Button variant="secondary" href={`/shipments/${shipment.id}`}>
            {t("orders.parcel", { number: shipment.number ?? "", status: shipment.status.toLowerCase().replace("_", " ") })}
          </Button>
        ) : null}
        {status === "DISPATCHED" && can.manage && shipment?.method !== "COURIER" ? (
          <Button loading={pending} onClick={() => step("deliver", t("orders.delivered"))}>
            {t("orders.deliver")}
          </Button>
        ) : null}
        {(status === "DRAFT" || status === "CONFIRMED" || status === "PACKED") && can.manage ? (
          <Button variant="danger" onClick={() => setCancelling(true)}>
            {t("orders.cancel")}
          </Button>
        ) : null}
        {status === "DISPATCHED" || status === "DELIVERED" ? (
          <Button variant="secondary" href="/sales/returns">
            {t("orders.returnGoods")}
          </Button>
        ) : null}
        <Button variant="ghost" href={`/orders/${id}/print`}>
          {t("orders.print")}
        </Button>
      </div>
      {dispatching ? (
        <fieldset className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-3">
          <legend className="px-1 text-sm font-medium">{t("orders.dispatchLegend")}</legend>
          <label className="grid gap-1 text-sm">
            {t("orders.dispatchedOn")}
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            {t("orders.fromAdvance", { advance })}
            <Input inputMode="decimal" value={fromAdvance} onChange={(event) => setFromAdvance(event.target.value)} placeholder="0.00" />
          </label>
          {deliveryMethod === "COURIER" ? (
            <>
              <label className="grid gap-1 text-sm">
                {t("orders.courier")}
                <select value={courierId} onChange={(event) => setCourierId(event.target.value)} className={field}>
                  {couriers.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                {t("orders.tracking")}
                <Input value={tracking} onChange={(event) => setTracking(event.target.value)} maxLength={64} />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={outside} onChange={(event) => setOutside(event.target.checked)} />
                {t("orders.outsideDhaka")}
              </label>
              <label className="grid gap-1 text-sm">
                {t("orders.deliveryCharge", { default: courier ? taka(outside ? courier.outsideDeliveryCharge : courier.defaultDeliveryCharge) : "-" })}
                <Input inputMode="decimal" value={deliveryCharge} onChange={(event) => setDeliveryCharge(event.target.value)} placeholder={t("orders.theCouriers")} />
              </label>
              <label className="grid gap-1 text-sm">
                {t("orders.conditionPercent", { default: courier?.defaultConditionPercent ?? "-" })}
                <Input inputMode="decimal" value={conditionPercent} onChange={(event) => setConditionPercent(event.target.value)} placeholder={t("orders.theCouriers")} />
              </label>
              <label className="grid gap-1 text-sm">
                {t("orders.chargeIs")}
                <select value={paidWith} onChange={(event) => setPaidWith(event.target.value as "DEDUCT" | "CASH" | "BANK")} className={field}>
                  <option value="DEDUCT">{t("orders.deduct")}</option>
                  <option value="CASH">{t("orders.paidCash")}</option>
                  <option value="BANK">{t("orders.paidBank")}</option>
                </select>
              </label>
              <p className="text-sm text-muted md:col-span-3">{t("orders.courierNote")}</p>
            </>
          ) : null}
          {deliveryMethod === "OWN_VEHICLE" ? (
            <>
              <label className="grid gap-1 text-sm">
                {t("orders.vehicleNo")}
                <Input value={vehicleNo} onChange={(event) => setVehicleNo(event.target.value)} maxLength={32} />
              </label>
              <label className="grid gap-1 text-sm">
                {t("orders.driver")}
                <Input value={driverName} onChange={(event) => setDriverName(event.target.value)} maxLength={191} />
              </label>
              <label className="grid gap-1 text-sm">
                {t("orders.driverPhone")}
                <Input value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} maxLength={32} />
              </label>
              <label className="grid gap-1 text-sm">
                {t("orders.fare")}
                <Input inputMode="decimal" value={deliveryCharge} onChange={(event) => setDeliveryCharge(event.target.value)} placeholder="0.00" />
              </label>
              <label className="grid gap-1 text-sm">
                {t("orders.paid")}
                <select value={paidWith === "BANK" ? "BANK" : "CASH"} onChange={(event) => setPaidWith(event.target.value as "CASH" | "BANK")} className={field}>
                  <option value="CASH">{t("orders.inCash")}</option>
                  <option value="BANK">{t("orders.byBank")}</option>
                </select>
              </label>
            </>
          ) : null}
          <div className="flex items-end">
            <Button loading={pending} onClick={dispatch}>
              {t("orders.dispatchNow")}
            </Button>
          </div>
        </fieldset>
      ) : null}
      {message ? (
        <p className="text-sm text-error" role="alert">
          {message}
        </p>
      ) : null}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("orders.cancelTitle")}
        description={t("orders.cancelBody")}
        confirmLabel={t("orders.cancel")}
        tone="danger"
        onConfirm={() => step("cancel", t("orders.cancelled"))}
      />
    </div>
  );
}
