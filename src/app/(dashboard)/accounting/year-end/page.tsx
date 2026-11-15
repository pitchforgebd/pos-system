import { redirect } from "next/navigation";

import { CloseYearForm } from "@/components/accounting/close-year-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { listYears } from "@/modules/accounting/year-end";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Year End");

export default async function YearEndPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const years = await listYears(session.organizationId);
  const canClose = session.permissions.has("period.close");

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Year end")}
        description={ph("Closing a finished fiscal year brings every income and expense account to zero in one entry on its last day and moves the profit to Retained Earnings. Then nothing can be posted into that year again. Close the years in order. It cannot be undone.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Year end") }]}
      />
      <DataTable
        caption={ph("Fiscal years")}
        columns={[
          { key: "label", header: ph("Year"), cell: (row) => row.label },
          { key: "range", header: ph("From - to"), cell: (row) => `${row.start} - ${row.end}` },
          { key: "profit", header: ph("Profit (loss)"), cell: (row) => row.profit },
          { key: "status", header: ph("State"), cell: (row) => (row.status === "CLOSED" ? "Closed" : row.status === "CURRENT" ? "Running" : "Over, not closed") },
          { key: "close", header: "", cell: (row) => (canClose && row.closable ? <CloseYearForm startYear={row.startYear} label={row.label} /> : null) },
        ]}
        rows={years}
        getRowKey={(row) => String(row.startYear)}
      />
    </div>
  );
}
