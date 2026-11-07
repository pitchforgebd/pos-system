import Link from "next/link";
import { redirect } from "next/navigation";

import { RequisitionForm } from "@/components/commerce/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listRequisitions } from "@/modules/commerce/requisitions";

export const metadata = { title: "Requisition" };

const statuses = ["REQUESTED", "APPROVED", "REJECTED", "FULFILLED"] as const;

export default async function RequisitionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const status = statuses.find((item) => item === params.status) ?? "";
  const requisitions = (await listRequisitions(session.organizationId, session.branchId)).filter((row) => !status || row.status === status);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requisition"
        description="A request can be approved or rejected on its own page. Fulfillment changes the status and does not move stock."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Requisitions" }]}
      />
      {session.permissions.has("requisitions.manage") ? <RequisitionForm /> : null}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/requisitions" className={status === "" ? "font-semibold" : "text-muted"}>
          All
        </Link>
        {statuses.map((item) => (
          <Link key={item} href={`/requisitions?status=${item}`} className={status === item ? "font-semibold" : "text-muted"}>
            {item === "REQUESTED" ? "To approve" : item.charAt(0) + item.slice(1).toLowerCase()}
          </Link>
        ))}
      </div>
      <DataTable
        caption="Requisitions"
        columns={[
          { key: "number", header: "Request", cell: (row) => <Link href={`/requisitions/${row.id}`}>{row.number}</Link> },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "requester", header: "Requester", cell: (row) => row.requesterName },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={requisitions}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No requisitions" description="A new request starts as requested." />}
      />
    </div>
  );
}
