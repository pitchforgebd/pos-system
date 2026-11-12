import { redirect } from "next/navigation";

import { CourierForm } from "@/components/shipping/courier-forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listCouriers } from "@/modules/shipping/couriers";

export const metadata = { title: "Courier" };

export default async function CourierSettingsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const couriers = await listCouriers(session.organizationId);
  const canEdit = session.permissions.has("settings.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Couriers"
        description="The couriers the shop sends parcels by. The condition percentage is what the courier keeps of the cash it collects; the delivery charge is what it charges per parcel. They are the default for each shipment, which may change them. Nothing is sent to an outside courier service: parcels are entered by hand."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Settings", href: "/settings" }, { label: "Courier" }]}
      />
      {canEdit ? (
        <section className="space-y-3" aria-label="Add a courier">
          <h2 className="text-lg font-semibold">Add a courier</h2>
          <CourierForm />
        </section>
      ) : null}
      <section className="space-y-3" aria-label="Couriers">
        {couriers.map((courier) =>
          canEdit ? (
            <CourierForm key={courier.id} initial={{ id: courier.id, name: courier.name, phone: courier.phone ?? "", status: courier.status, defaultConditionPercent: courier.defaultConditionPercent, defaultDeliveryCharge: courier.defaultDeliveryCharge, outsideDeliveryCharge: courier.outsideDeliveryCharge }} />
          ) : (
            <p key={courier.id} className="rounded-md border border-border p-3 text-sm">
              {courier.name} · condition {courier.defaultConditionPercent}% · delivery {courier.defaultDeliveryCharge} / outside {courier.outsideDeliveryCharge}
            </p>
          ),
        )}
      </section>
    </div>
  );
}
