import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listLedger } from "@/modules/inventory/stock";

export const metadata = { title: "Product Ledger Table" };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const rows = await listLedger(session.organizationId, session.branchId, q);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Ledger Table"
        description="Each row is one stock movement. The latest 100 rows for this branch are shown."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Product Ledger Table" }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/inventory/ledger">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={q} placeholder="Name or SKU" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Product ledger"
        columns={[
          { key: "when", header: "When", cell: (row) => row.createdAt.slice(0, 16).replace("T", " ") },
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "place", header: "Place", cell: (row) => row.warehouseName },
          { key: "type", header: "Type", cell: (row) => row.movementType },
          { key: "direction", header: "Direction", cell: (row) => row.direction },
          { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No movements" description="Opening stock, sales, damage, and expiry write-offs appear here." />}
      />
    </div>
  );
}
