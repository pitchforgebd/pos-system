import Link from "next/link";

import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";

type SaleRow = {
  id: string;
  number: string | null;
  status: string;
  total: string;
  occurredOn: string;
  customerName: string;
};

export function SalesTable({ rows }: { rows: SaleRow[] }) {
  return (
    <DataTable
      caption="Sales"
      columns={[
        { key: "number", header: "Invoice", cell: (row) => <Link href={`/sales/${row.id}`}>{row.number ?? "Sale"}</Link> },
        { key: "date", header: "Date", cell: (row) => row.occurredOn },
        { key: "customer", header: "Customer", cell: (row) => row.customerName },
        { key: "total", header: "Total", cell: (row) => row.total },
        { key: "status", header: "Status", cell: (row) => row.status },
      ]}
      rows={rows}
      getRowKey={(row) => row.id}
      empty={<EmptyState title="No sales" description="Post a sale from the register. The server recalculates the total." />}
    />
  );
}
