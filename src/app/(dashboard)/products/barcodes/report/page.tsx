import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listBarcodePrints } from "@/modules/catalog/barcodes";

export const metadata = { title: "Barcode print report" };

export default async function BarcodeReportPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const rows = await listBarcodePrints(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Barcode print report"
        description="Each prepared label is listed. Copies are a layout count and do not change stock."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Barcode report" }]}
        actions={<Button href="/products/barcodes">Print labels</Button>}
      />
      <DataTable
        caption="Prints"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "barcode", header: "Barcode", cell: (row) => row.barcode },
          { key: "product", header: "Product", cell: (row) => row.product },
          { key: "level", header: "Price level", cell: (row) => row.level },
          { key: "format", header: "Layout", cell: (row) => (row.format === "LABEL_38X25" ? "38 × 25 mm" : row.format === "A4" ? "A4 sheet" : row.format) },
          { key: "copies", header: "Copies", cell: (row) => row.copies },
          { key: "user", header: "Printed by", cell: (row) => row.user },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No labels prepared" description="Prepare a label to record it here." />}
      />
    </div>
  );
}
