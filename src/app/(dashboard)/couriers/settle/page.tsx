import { redirect } from "next/navigation";

import { SettleForm } from "@/components/shipping/settle-form";
import { PageHeader } from "@/components/ui/page-header";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { listCouriers } from "@/modules/shipping/couriers";
import { unsettledParcels } from "@/modules/shipping/settlements";

export const metadata = { title: "Courier settlement" };

export default async function SettleCourierPage({ searchParams }: { searchParams: Promise<{ courierId?: string }> }) {
  const session = await getSession();
  if (!session?.branchId || !session.permissions.has("couriers.settle")) {
    redirect("/couriers");
  }
  const params = await searchParams;
  const couriers = await listCouriers(session.organizationId);
  const courier = couriers.find((row) => row.id === params.courierId);
  const [parcels, accounts] = courier ? await Promise.all([unsettledParcels(session.organizationId, session.branchId, courier.id), moneyAccountOptions(session.organizationId)]) : [[], []];

  return (
    <div className="space-y-6">
      <PageHeader
        title={courier ? `Settle ${courier.name}` : "Courier settlement"}
        description="Tick the parcels this payment is for. A parcel is settled once. If what came is not what should have, give the reason: it needs the owner's approval."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Courier dues", href: "/couriers" }, { label: "Settle" }]}
      />
      {courier ? (
        <SettleForm
          courierId={courier.id}
          parcels={parcels}
          accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
          today={businessDate()}
          canApproveDifference={session.permissions.has("couriers.approve_difference")}
        />
      ) : (
        <ul className="space-y-1 text-sm">
          {couriers.map((row) => (
            <li key={row.id}>
              <a className="underline" href={`/couriers/settle?courierId=${row.id}`}>
                {row.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
