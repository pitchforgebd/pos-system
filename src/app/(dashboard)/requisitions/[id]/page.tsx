import { notFound, redirect } from "next/navigation";

import { StatusAction } from "@/components/commerce/forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getRequisition } from "@/modules/commerce/requisitions";

export const metadata = { title: "Requisition" };

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
        description={`${requisition.requesterName} · ${requisition.occurredOn} · ${requisition.status}. Fulfillment does not move stock.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Requisitions", href: "/requisitions" }, { label: requisition.number }]}
      />
      <p className="text-sm">{requisition.note}</p>
      <div className="flex gap-2">
        {requisition.status === "REQUESTED" ? (
          <>
            <StatusAction url={`/api/v1/requisitions/${requisition.id}/approve`} label="Approve" />
            <StatusAction url={`/api/v1/requisitions/${requisition.id}/reject`} label="Reject" />
          </>
        ) : null}
        {requisition.status === "APPROVED" ? <StatusAction url={`/api/v1/requisitions/${requisition.id}/fulfill`} label="Fulfill" /> : null}
      </div>
    </div>
  );
}
