import { redirect } from "next/navigation";

import { ProductImportForm } from "@/components/imports/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { latestProductImport } from "@/modules/imports/product-import";

export const metadata = { title: "Import products" };

export default async function ProductImportPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const latest = session.permissions.has("products.import") ? await latestProductImport(session.organizationId) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import products"
        description="Preview the CSV, then confirm. A failed row does not undo an earlier row. An existing SKU is skipped."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Import" }]}
      />
      {session.permissions.has("products.import") ? <ProductImportForm canExport={session.permissions.has("products.export")} /> : <p className="text-sm text-muted">Import permission is required.</p>}
      <DataTable
        caption="Latest import"
        columns={[
          { key: "row", header: "Row", cell: (row) => String(row.rowNumber) },
          { key: "status", header: "Result", cell: (row) => row.status },
          { key: "message", header: "Message", cell: (row) => row.message },
        ]}
        rows={latest?.rows ?? []}
        getRowKey={(row) => String(row.rowNumber)}
        empty={<EmptyState title="No import yet" description="Confirm a CSV to record the summary." />}
      />
      {latest ? (
        <p className="text-sm text-muted">
          Total {latest.total}. Success {latest.success}. Failed {latest.failed}. Skipped {latest.skipped}.
        </p>
      ) : null}
    </div>
  );
}
