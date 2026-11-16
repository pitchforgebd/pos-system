import { notFound, redirect } from "next/navigation";

import { StatusAction } from "@/components/commerce/forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getRequisition } from "@/modules/commerce/requisitions";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Requisition");

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const requisition = await getRequisition(session.organizationId, session.branchId, id);
  if (!requisition) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={requisition.number}
        description={`${requisition.requesterName} · ${requisition.businessDate} · ${ph(requisition.status === "REQUESTED" ? "To approve" : requisition.status.charAt(0) + requisition.status.slice(1).toLowerCase())}. ${ph("Fulfillment does not move stock.")}`}
        breadcrumbs={[{ label: ph("Home"), href: "/dashboard" }, { label: ph("Requisitions"), href: "/requisitions" }, { label: requisition.number }]}
      />
      <p className="text-sm">{requisition.note}</p>
      <div className="flex gap-2">
        {requisition.status === "REQUESTED" ? (
          <>
            <StatusAction url={`/api/v1/requisitions/${requisition.id}/approve`} label={ph("Approve")} />
            <StatusAction url={`/api/v1/requisitions/${requisition.id}/reject`} label={ph("Reject")} />
          </>
        ) : null}
        {requisition.status === "APPROVED" ? <StatusAction url={`/api/v1/requisitions/${requisition.id}/fulfill`} label={ph("Fulfill")} /> : null}
      </div>
    </div>
  );
}
