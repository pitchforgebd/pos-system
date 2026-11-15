import { redirect } from "next/navigation";

import { ProductImportForm } from "@/components/imports/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { latestProductImport } from "@/modules/imports/product-import";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Import products");

export default async function ProductImportPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const latest = session.permissions.has("products.import") ? await latestProductImport(session.organizationId) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Import products")}
        description={ph("Preview the CSV, then confirm. A failed row does not undo an earlier row. An existing SKU is skipped.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("Import") }]}
      />
      {session.permissions.has("products.import") ? <ProductImportForm canExport={session.permissions.has("products.export")} /> : <p className="text-sm text-muted">{ph("Import permission is required.")}</p>}
      <DataTable
        caption={ph("Latest import")}
        columns={[
          { key: "row", header: ph("Row"), cell: (row) => String(row.rowNumber) },
          { key: "status", header: ph("Result"), cell: (row) => row.status },
          { key: "message", header: ph("Message"), cell: (row) => row.message },
        ]}
        rows={latest?.rows ?? []}
        getRowKey={(row) => String(row.rowNumber)}
        empty={<EmptyState title={ph("No import yet")} description={ph("Confirm a CSV to record the summary.")} />}
      />
      {latest ? (
        <p className="text-sm text-muted">
          {ph("Total")} {latest.total}{ph(". Success")} {latest.success}{ph(". Failed")} {latest.failed}{ph(". Skipped")} {latest.skipped}.
        </p>
      ) : null}
    </div>
  );
}
