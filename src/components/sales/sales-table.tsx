import Link from "next/link";

import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { getI18n } from "@/lib/i18n/server";

type SaleRow = {
  id: string;
  number: string | null;
  status: string;
  total: string;
  businessDate: string;
  customerName: string;
};

export async function SalesTable({ rows }: { rows: SaleRow[] }) {
  const { t, taka, date } = await getI18n("sales");
  const status = (value: string) => (value === "DRAFT" ? t("sales.DRAFT") : value === "POSTED" ? t("sales.POSTED") : value === "CANCELLED" ? t("sales.CANCELLED") : value);
  return (
    <DataTable
      caption={t("sales.tableCaption")}
      columns={[
        { key: "number", header: t("sales.colInvoice"), cell: (row) => <Link href={`/sales/${row.id}`}>{row.number ?? t("sales.fallback")}</Link> },
        { key: "date", header: t("sales.colDate"), cell: (row) => date(row.businessDate) },
        { key: "customer", header: t("sales.colCustomer"), cell: (row) => row.customerName },
        { key: "total", header: t("sales.colTotal"), cell: (row) => taka(row.total) },
        { key: "status", header: t("sales.colStatus"), cell: (row) => status(row.status) },
      ]}
      rows={rows}
      getRowKey={(row) => row.id}
      empty={<EmptyState title={t("sales.emptyTitle")} description={t("sales.emptyBody")} />}
    />
  );
}
