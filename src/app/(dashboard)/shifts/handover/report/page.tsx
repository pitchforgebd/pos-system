import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listHandovers } from "@/modules/shifts/handovers";

export const metadata = { title: "Handover Report" };

export default async function HandoverReportPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const rows = await listHandovers(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Handover Report"
        description="This list is the stored handover amounts. Expected cash is not recalculated here."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Shifts", href: "/shifts" }, { label: "Handover Report" }]}
      />
      <DataTable
        caption="Handover report"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.createdOn },
          { key: "from", header: "From", cell: (row) => row.fromName },
          { key: "to", header: "To", cell: (row) => row.toName },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
          { key: "shift", header: "Shift", cell: (row) => <Link href={`/shifts/${row.shiftId}`}>{row.status}</Link> },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No handover" description="Nothing is listed until a closing shift records a handover." />}
      />
    </div>
  );
}
