import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/modules/auth/current-session";
import { courierDues, listSettlements, OVERDUE_DAYS } from "@/modules/shipping/settlements";

export const metadata = { title: "Courier dues" };

// The condition dashboard: what each courier owes the shop (the cash it collected and has not paid), what is on the way, what waits to be
// settled and what has waited too long.
export default async function CouriersPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [dues, settlements] = await Promise.all([courierDues(session.organizationId, session.branchId), listSettlements(session.organizationId, session.branchId)]);
  const late = dues.filter((due) => due.overdue > 0);
  const canSettle = session.permissions.has("couriers.settle");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Courier dues"
        description="What each courier owes the shop: the cash it collected from customers, less its delivery and condition charges. A parcel delivered more than a week ago and not settled is flagged."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Courier dues" }]}
        actions={
          <Button variant="secondary" href="/shipments">
            Shipments
          </Button>
        }
      />
      {late.length > 0 ? (
        <p className="rounded-md border border-warning/30 bg-warning-subtle p-3 text-sm" role="status">
          Waiting more than {OVERDUE_DAYS} days: {late.map((due) => `${due.name} (${due.overdue} parcel${due.overdue === 1 ? "" : "s"}, ${due.oldestDays} days)`).join(", ")}.
        </p>
      ) : null}
      <DataTable
        caption="Couriers"
        columns={[
          { key: "name", header: "Courier", cell: (row) => <Link href={`/shipments?courierId=${row.courierId}`}>{row.name}</Link> },
          { key: "owed", header: "Owes the shop", cell: (row) => row.owed },
          { key: "transit", header: "On the way", cell: (row) => row.inTransit },
          { key: "waiting", header: "Waiting to settle", cell: (row) => `${row.waiting} · ${row.waitingAmount}` },
          { key: "late", header: `Over ${OVERDUE_DAYS} days`, cell: (row) => (row.overdue > 0 ? <StatusBadge tone="warning">{`${row.overdue} · ${row.oldestDays} d`}</StatusBadge> : "") },
          { key: "settle", header: "", cell: (row) => (canSettle && row.waiting > 0 ? <Link href={`/couriers/settle?courierId=${row.courierId}`}>Settle</Link> : "") },
        ]}
        rows={dues}
        getRowKey={(row) => row.courierId}
        empty={<EmptyState title="No couriers" description="Add the couriers in Settings, Courier." />}
      />
      <DataTable
        caption="Settlements"
        columns={[
          { key: "number", header: "Settlement", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "courier", header: "Courier", cell: (row) => row.courierName },
          { key: "parcels", header: "Parcels", cell: (row) => row.parcels },
          { key: "gross", header: "Cash collected", cell: (row) => row.grossCod },
          { key: "charges", header: "Charges", cell: (row) => `${row.deliveryCharges} + ${row.conditionCharges}` },
          { key: "received", header: "Received", cell: (row) => row.netReceived },
          { key: "difference", header: "Difference", cell: (row) => (row.difference === "0.00" ? "" : `${row.difference} (${row.differenceReason ?? ""})`) },
        ]}
        rows={settlements}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No settlements" description="A settlement is recorded when a courier pays what it collected." />}
      />
    </div>
  );
}
