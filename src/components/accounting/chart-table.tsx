import Link from "next/link";

import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";

export function ChartAccountTable({ rows }: { rows: { id: string; code: string; name: string; groupName: string }[] }) {
  return (
    <DataTable
      caption="Accounts"
      columns={[
        { key: "code", header: "Code", cell: (row) => row.code },
        { key: "name", header: "Account", cell: (row) => row.name },
        { key: "group", header: "Group", cell: (row) => row.groupName },
        {
          key: "ledger",
          header: "Ledger",
          cell: (row) => <Link href={`/accounting/statements?accountCode=${row.code}`}>Statement</Link>,
        },
      ]}
      rows={rows}
      getRowKey={(row) => row.id}
      empty={<EmptyState title="No accounts" description="The chart has no account in this group." />}
    />
  );
}
