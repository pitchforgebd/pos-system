import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { dueSaleReport } from "@/modules/reports/reports";

export const metadata = { title: "Due date invoices" };

const buckets = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
] as const;

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function windowFor(bucket: string) {
  const now = new Date();
  const end = iso(now);
  if (bucket === "week") {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 6);
    return { from: iso(start), to: end };
  }
  if (bucket === "month") {
    return { from: `${end.slice(0, 8)}01`, to: end };
  }
  if (bucket === "year") {
    return { from: `${end.slice(0, 4)}-01-01`, to: end };
  }
  return { from: end, to: end };
}

export default async function DueDateInvoicesPage({ searchParams }: { searchParams: Promise<{ bucket?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const bucket = buckets.some((item) => item.id === query.bucket) ? query.bucket! : "today";
  const range = windowFor(bucket);
  const report = await dueSaleReport({
    organizationId: session.organizationId,
    branchId: session.branchId,
    from: range.from,
    to: range.to,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Due Date Invoice"
        description="Open dues on this branch. The date is the invoice date. A separate promise date is not stored. The latest 100 posted sales in the range are checked."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Due Date Invoice" }]}
      />
      <div className="flex flex-wrap gap-2">
        {buckets.map((item) => (
          <Link
            key={item.id}
            href={`/sales/due-dates?bucket=${item.id}`}
            className={`inline-flex h-9 items-center rounded-md px-3 text-sm ${item.id === bucket ? "bg-primary text-primary-foreground" : "border border-border"}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <DataTable
        caption="Open invoice dues"
        columns={[
          { key: "date", header: "Invoice date", cell: (row) => row.occurredOn },
          { key: "number", header: "Invoice", cell: (row) => row.number },
          { key: "party", header: "Customer", cell: (row) => row.party },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "paid", header: "Paid", cell: (row) => row.cash },
          { key: "due", header: "Due", cell: (row) => row.due },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No due invoices" description="A posted sale with an unpaid balance in this range appears here." />}
      />
    </div>
  );
}
