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
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Barcode labels");

export default async function BarcodesPage({ searchParams }: { searchParams: Promise<{ q?: string; level?: string }> }) {
  const ph = await getPhrase();
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
        title={ph("Barcode labels")}
        description={ph("A label shows the product, the barcode and the price at the level chosen: on an A4 sheet (3 or 5 across) or on a thermal label printer (38 × 25, 50 × 25, 40 × 30, 50 × 30 mm, or two across on a roll). Copies do not change stock, and every print is recorded.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("Barcodes") }]}
        actions={<Button href="/products/barcodes/report" variant="secondary">{ph("Print report")}</Button>}
      />
      <form className="flex flex-wrap items-end gap-2" action="/products/barcodes">
        <label className="grid min-w-48 flex-1 gap-1 text-sm">
          {ph("Search")}
          <input name="q" defaultValue={params.q ?? ""} placeholder={ph("Barcode, name or SKU")} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Price on the label")}
          <select name="level" defaultValue={level} className="h-10 rounded-md border border-border bg-surface px-2">
            {active.map((row) => (
              <option key={row.id} value={row.name}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          {ph("Show")}
        </Button>
      </form>
      <DataTable
        caption={ph("Barcodes")}
        columns={[
          { key: "barcode", header: ph("Barcode"), cell: (row) => row.barcode },
          { key: "product", header: ph("Product"), cell: (row) => row.product },
          { key: "price", header: `Price (${level})`, cell: (row) => row.price },
          { key: "print", header: ph("Print"), cell: (row) => <BarcodePrintForm barcodeId={row.id} levels={[level, ...active.map((r) => r.name).filter((name) => name !== level)]} /> },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No barcodes")} description={ph("Add a barcode on a product to print a label.")} />}
      />
    </div>
  );
}
