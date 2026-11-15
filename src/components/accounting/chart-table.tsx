import Link from "next/link";

import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { getPhrase } from "@/lib/i18n/server";

export async function ChartAccountTable({ rows }: { rows: { id: string; code: string; name: string; groupName: string }[] }) {
  const ph = await getPhrase();
  return (
    <DataTable
      caption={ph("Accounts")}
      columns={[
        { key: "code", header: ph("Code"), cell: (row) => row.code },
        { key: "name", header: ph("Account"), cell: (row) => row.name },
        { key: "group", header: ph("Group"), cell: (row) => row.groupName },
        {
          key: "ledger",
          header: ph("Ledger"),
          cell: (row) => <Link href={`/accounting/statements?accountCode=${row.code}`}>{ph("Statement")}</Link>,
        },
      ]}
      rows={rows}
      getRowKey={(row) => row.id}
      empty={<EmptyState title={ph("No accounts")} description={ph("The chart has no account in this group.")} />}
    />
  );
}
