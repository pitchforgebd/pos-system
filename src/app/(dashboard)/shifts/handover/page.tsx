import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listHandovers } from "@/modules/shifts/handovers";

export const metadata = { title: "Cash Handover" };

export default async function HandoverPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const rows = await listHandovers(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash Handover"
        description="A handover is recorded when a counted shift gives its drawer to another user. When the cash goes into another cash account (the main cash, a safe) it is a transfer and leaves the drawer."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Shifts", href: "/shifts" }, { label: "Cash Handover" }]}
      />
      <p className="text-sm">
        <Link href="/shifts?view=close">Close My Shift</Link>
      </p>
      <DataTable
        caption="Handovers"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.createdOn },
          { key: "from", header: "From", cell: (row) => row.fromName },
          { key: "to", header: "To", cell: (row) => row.toName },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
          { key: "shift", header: "Shift", cell: (row) => <Link href={`/shifts/${row.shiftId}`}>{row.status}</Link> },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No handover" description="Record one from a shift that is counted and not yet closed." />}
      />
    </div>
  );
}
