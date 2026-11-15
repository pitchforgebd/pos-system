import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listHandovers } from "@/modules/shifts/handovers";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Cash Handover");

export default async function HandoverPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const rows = await listHandovers(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Cash Handover")}
        description={ph("A handover is recorded when a counted shift gives its drawer to another user. When the cash goes into another cash account (the main cash, a safe) it is a transfer and leaves the drawer.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Shifts", href: "/shifts" }, { label: ph("Cash Handover") }]}
      />
      <p className="text-sm">
        <Link href="/shifts?view=close">{ph("Close My Shift")}</Link>
      </p>
      <DataTable
        caption={ph("Handovers")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.createdOn },
          { key: "from", header: ph("From"), cell: (row) => row.fromName },
          { key: "to", header: ph("To"), cell: (row) => row.toName },
          { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
          { key: "shift", header: ph("Shift"), cell: (row) => <Link href={`/shifts/${row.shiftId}`}>{row.status}</Link> },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No handover")} description={ph("Record one from a shift that is counted and not yet closed.")} />}
      />
    </div>
  );
}
