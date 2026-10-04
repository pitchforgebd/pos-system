import { redirect } from "next/navigation";

import { BarcodePrintForm } from "@/components/print/barcode-form";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listBarcodes } from "@/modules/catalog/barcodes";

export const metadata = { title: "Barcode labels" };

export default async function BarcodesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const rows = await listBarcodes(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Barcode labels"
        description="Labels use the stored barcode and selling price. Copies do not change stock."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Barcodes" }]}
        actions={<Button href="/products/barcodes/report" variant="secondary">Print report</Button>}
      />
      <DataTable
        caption="Barcodes"
        columns={[
          { key: "barcode", header: "Barcode", cell: (row) => row.barcode },
          { key: "product", header: "Product", cell: (row) => row.product },
          { key: "price", header: "Selling price", cell: (row) => row.sellingPrice },
          { key: "print", header: "Print", cell: (row) => <BarcodePrintForm barcodeId={row.id} /> },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No barcodes" description="Add a barcode on a product to print a label." />}
      />
    </div>
  );
}
