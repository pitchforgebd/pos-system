import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/client";
import { BarcodePrintForm } from "@/components/print/barcode-form";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listBarcodes } from "@/modules/catalog/barcodes";
import { ensurePriceLevels } from "@/modules/pricing";

export const metadata = { title: "Barcode labels" };

export default async function BarcodesPage({ searchParams }: { searchParams: Promise<{ q?: string; level?: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const { levels, defaultLevel } = await ensurePriceLevels(prisma, session.organizationId);
  const active = levels.filter((level) => level.status === "ACTIVE");
  const level = active.find((row) => row.name === params.level)?.name ?? defaultLevel.name;
  const rows = await listBarcodes(session.organizationId, { level, search: params.q });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Barcode labels"
        description="A label shows the barcode and the price at the level chosen, on an A4 sheet or a 38 × 25 mm label. Copies do not change stock, and every print is recorded."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Barcodes" }]}
        actions={<Button href="/products/barcodes/report" variant="secondary">Print report</Button>}
      />
      <form className="flex flex-wrap items-end gap-2" action="/products/barcodes">
        <label className="grid min-w-48 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Barcode, name or SKU" className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          Price on the label
          <select name="level" defaultValue={level} className="h-10 rounded-md border border-border bg-surface px-2">
            {active.map((row) => (
              <option key={row.id} value={row.name}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <DataTable
        caption="Barcodes"
        columns={[
          { key: "barcode", header: "Barcode", cell: (row) => row.barcode },
          { key: "product", header: "Product", cell: (row) => row.product },
          { key: "price", header: `Price (${level})`, cell: (row) => row.price },
          { key: "print", header: "Print", cell: (row) => <BarcodePrintForm barcodeId={row.id} levels={[level, ...active.map((r) => r.name).filter((name) => name !== level)]} /> },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No barcodes" description="Add a barcode on a product to print a label." />}
      />
    </div>
  );
}
