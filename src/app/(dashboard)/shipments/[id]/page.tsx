import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ShipmentActions } from "@/components/shipping/shipment-actions";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { getShipment } from "@/modules/shipping/shipments";

export const metadata = { title: "Shipment" };

const TONE = { CREATED: "neutral", PICKED: "info", IN_TRANSIT: "info", DELIVERED: "success", RETURNED: "error", LOST: "error" } as const;

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const shipment = await getShipment(session.organizationId, session.branchId, id);
  if (!shipment) {
    notFound();
  }
  const title = shipment.number ?? "Shipment";

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={`${shipment.customer?.name ?? ""} · ${shipment.method === "COURIER" ? (shipment.courier?.name ?? "Courier") : "Own vehicle"}${shipment.trackingCode ? ` · tracking ${shipment.trackingCode}` : ""}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Shipments", href: "/shipments" }, { label: title }]}
        actions={<StatusBadge tone={TONE[shipment.status]}>{shipment.status.replace("_", " ")}</StatusBadge>}
      />
      <ShipmentActions id={shipment.id} status={shipment.status} method={shipment.method} today={businessDate()} can={session.permissions.has("shipments.manage")} />
      <dl className="grid max-w-xl grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {shipment.method === "COURIER" ? (
          <>
            <dt>Cash to collect from the customer</dt>
            <dd className="text-right tabular-nums">{shipment.codAmount}</dd>
            <dt>Delivery charge ({shipment.deliveryPaidWith === "DEDUCT" ? "kept out of the settlement" : shipment.deliveryPaidWith === "BANK" ? "paid by bank" : "paid in cash"})</dt>
            <dd className="text-right tabular-nums">{shipment.deliveryCharge}</dd>
            <dt>Condition charge ({shipment.conditionPercent}%)</dt>
            <dd className="text-right tabular-nums">{shipment.conditionCharge}</dd>
            {shipment.returnCharge !== "0.00" ? (
              <>
                <dt>Return charge</dt>
                <dd className="text-right tabular-nums">{shipment.returnCharge}</dd>
              </>
            ) : null}
            <dt className="font-medium">What the courier should pay the shop</dt>
            <dd className="text-right font-medium tabular-nums">{shipment.expectedNet}</dd>
          </>
        ) : (
          <>
            <dt>Vehicle</dt>
            <dd className="text-right">{shipment.vehicleNo ?? ""}</dd>
            <dt>Driver</dt>
            <dd className="text-right">{[shipment.driverName, shipment.driverPhone].filter(Boolean).join(" · ")}</dd>
            <dt>Fare</dt>
            <dd className="text-right tabular-nums">{shipment.deliveryCharge}</dd>
          </>
        )}
        <dt>Sent</dt>
        <dd className="text-right">{shipment.dispatchedOn ?? ""}</dd>
        {shipment.deliveredOn ? (
          <>
            <dt>Delivered</dt>
            <dd className="text-right">{shipment.deliveredOn}</dd>
          </>
        ) : null}
        {shipment.returnedOn ? (
          <>
            <dt>Came back</dt>
            <dd className="text-right">{shipment.returnedOn}</dd>
          </>
        ) : null}
      </dl>
      {shipment.address ? <p className="text-sm">Deliver to: {shipment.address}</p> : null}
      <p className="text-sm">
        {shipment.sale ? (
          <>
            Invoice <Link href={`/sales/${shipment.sale.id}`}>{shipment.sale.number}</Link>
          </>
        ) : null}
        {shipment.order ? (
          <>
            {" · "}Order <Link href={`/orders/${shipment.order.id}`}>{shipment.order.number}</Link>
          </>
        ) : null}
        {shipment.settlement ? ` · settled in ${shipment.settlement.number}` : ""}
      </p>
      <section aria-label="History">
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <ol className="space-y-1 text-sm">
          {shipment.events.map((event) => (
            <li key={event.id}>
              <span className="text-muted">{event.at.slice(0, 16).replace("T", " ")}</span> · <strong>{event.status.replace("_", " ")}</strong>
              {event.by ? ` · ${event.by}` : ""}
              {event.note ? ` · ${event.note}` : ""}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
