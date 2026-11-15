import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listLedger } from "@/modules/inventory/stock";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Product Ledger Table");

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ph = await getPhrase();
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
        title={ph("Product Ledger Table")}
        description={ph("Each row is one stock movement. The latest 100 rows for this branch are shown.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Product Ledger Table") }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/inventory/ledger">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          {ph("Search")}
          <input name="q" defaultValue={q} placeholder={ph("Name or SKU")} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          {ph("Search")}
        </Button>
      </form>
      <DataTable
        caption={ph("Product ledger")}
        columns={[
          { key: "when", header: ph("When"), cell: (row) => row.createdAt.slice(0, 16).replace("T", " ") },
          { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
          { key: "name", header: ph("Product"), cell: (row) => row.name },
          { key: "place", header: ph("Place"), cell: (row) => row.warehouseName },
          { key: "type", header: ph("Type"), cell: (row) => row.movementType },
          { key: "direction", header: ph("Direction"), cell: (row) => row.direction },
          { key: "quantity", header: ph("Quantity"), cell: (row) => row.quantity },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No movements")} description={ph("Opening stock, sales, damage, and expiry write-offs appear here.")} />}
      />
    </div>
  );
}
