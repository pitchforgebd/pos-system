import { redirect } from "next/navigation";

import { CourierForm, ShipmentForm } from "@/components/reference/gap-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomers } from "@/modules/customers/customers";
import { listCouriers, listShipments } from "@/modules/reference/extras";

export const metadata = { title: "Courier" };

export default async function CourierPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [couriers, shipments, customers] = await Promise.all([
    listCouriers(session.organizationId),
    listShipments(session.organizationId, session.branchId),
    listCustomers(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Courier"
        description="Save a courier and a shipment on this branch. The row is stored here. No outside courier service is called."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Settings", href: "/settings" }, { label: "Courier" }]}
      />
      {session.permissions.has("settings.manage") ? (
        <>
          <CourierForm />
          <ShipmentForm
            couriers={couriers.map((courier) => ({ id: courier.id, label: courier.name }))}
            customers={customers.filter((customer) => customer.status === "ACTIVE").map((customer) => ({ id: customer.id, label: customer.name }))}
          />
        </>
      ) : null}
      <DataTable
        caption="Couriers"
        columns={[
          { key: "name", header: "Courier", cell: (row) => row.name },
          { key: "phone", header: "Phone", cell: (row) => row.phone ?? "" },
        ]}
        rows={couriers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No courier" description="Save a courier name before creating a shipment." />}
      />
      <DataTable
        caption="Shipments"
        columns={[
          { key: "courier", header: "Courier", cell: (row) => row.courierName },
          { key: "customer", header: "Customer", cell: (row) => row.customerName },
          { key: "reference", header: "Reference", cell: (row) => row.reference },
          { key: "tracking", header: "Tracking", cell: (row) => row.trackingCode },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={shipments}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No shipments" description="A shipment stores a courier, an optional customer, and a tracking code." />}
      />
    </div>
  );
}
