import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listPurchaseReturns } from "@/modules/purchasing/returns";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Supplier returns");

export default async function SupplierReturnsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const returns = await listPurchaseReturns(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Supplier returns")}
        description={ph("Purchase returns for this branch.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: ph("Returns") }]}
        actions={
          session.permissions.has("purchase.return") ? (
            <Button href="/purchases/returns" variant="secondary">
              {ph("New return")}
            </Button>
          ) : null
        }
      />
      <DataTable
        caption={ph("Supplier returns")}
        columns={[
          { key: "number", header: ph("Return"), cell: (row) => row.number },
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "source", header: ph("Purchase"), cell: (row) => row.source },
          { key: "supplier", header: ph("Supplier"), cell: (row) => row.supplierName },
          { key: "total", header: ph("Total"), cell: (row) => row.total },
        ]}
        rows={returns}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No supplier returns")} description={ph("A supplier return is posted from the purchase return screen.")} />}
      />
    </div>
  );
}
