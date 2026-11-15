import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { addDays, businessDate } from "@/core/time/business-date";
import { titled } from "@/lib/i18n/metadata";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { dueSaleReport } from "@/modules/reports/reports";

export const generateMetadata = titled("sales", "sales.dueTitle");

const buckets = ["today", "week", "month", "year"] as const;

/** The days a bucket covers, counted in the shop's own (Dhaka) day. */
function windowFor(bucket: string) {
  const end = businessDate();
  if (bucket === "week") {
    return { from: addDays(end, -6), to: end };
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
  const { t, taka, date } = await getI18n("sales");
  const query = await searchParams;
  const bucket = buckets.find((item) => item === query.bucket) ?? "today";
  const range = windowFor(bucket);
  const report = await dueSaleReport({
    organizationId: session.organizationId,
    branchId: session.branchId,
    from: range.from,
    to: range.to,
  });
  const label = { today: t("sales.dueToday"), week: t("sales.dueWeek"), month: t("sales.dueMonth"), year: t("sales.dueYear") } as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("sales.dueTitle")}
        description={t("sales.dueDescription")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Due Date Invoice" }]}
      />
      <div className="flex flex-wrap gap-2">
        {buckets.map((item) => (
          <Link
            key={item}
            href={`/sales/due-dates?bucket=${item}`}
            className={`inline-flex h-9 items-center rounded-md px-3 text-sm ${item === bucket ? "bg-primary text-primary-foreground" : "border border-border"}`}
          >
            {label[item]}
          </Link>
        ))}
      </div>
      <DataTable
        caption={t("sales.dueCaption")}
        columns={[
          { key: "date", header: t("sales.dueColDate"), cell: (row) => date(row.businessDate) },
          { key: "number", header: t("sales.colInvoice"), cell: (row) => row.number },
          { key: "party", header: t("sales.colCustomer"), cell: (row) => row.party },
          { key: "total", header: t("sales.colTotal"), cell: (row) => taka(row.total) },
          { key: "paid", header: t("sales.dueColPaid"), cell: (row) => taka(row.cash) },
          { key: "due", header: t("sales.dueColDue"), cell: (row) => taka(row.due) },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={t("sales.dueEmptyTitle")} description={t("sales.dueEmptyBody")} />}
      />
    </div>
  );
}
