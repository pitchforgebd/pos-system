import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listBarcodePrints } from "@/modules/catalog/barcodes";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Barcode print report");

export default async function BarcodeReportPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const rows = await listBarcodePrints(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Barcode print report")}
        description={ph("Each prepared label is listed. Copies are a layout count and do not change stock.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("Barcode report") }]}
        actions={<Button href="/products/barcodes">{ph("Print labels")}</Button>}
      />
      <DataTable
        caption={ph("Prints")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "barcode", header: ph("Barcode"), cell: (row) => row.barcode },
          { key: "product", header: ph("Product"), cell: (row) => row.product },
          { key: "level", header: ph("Price level"), cell: (row) => row.level },
          { key: "format", header: ph("Layout"), cell: (row) => (row.format === "LABEL_38X25" ? "38 × 25 mm" : row.format === "A4" ? "A4 sheet" : row.format) },
          { key: "copies", header: ph("Copies"), cell: (row) => row.copies },
          { key: "user", header: ph("Printed by"), cell: (row) => row.user },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No labels prepared")} description={ph("Prepare a label to record it here.")} />}
      />
    </div>
  );
}
