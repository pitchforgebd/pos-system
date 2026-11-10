import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BarcodeAddForm, PriceStepsForm, ProductEditForm, VariantAddForm } from "@/components/catalog/product-edit";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getProductDetail } from "@/modules/catalog/detail";
import { getProduct } from "@/modules/catalog/products";
import { listBrands, listCategories, listUnits } from "@/modules/catalog/references";
import { listVariationHeads } from "@/modules/catalog/variations";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const canSeeCost = session.permissions.has("products.cost");
  const canEdit = session.permissions.has("products.edit");
  const [detail, editable, brands, categories, units, heads] = await Promise.all([
    getProductDetail(session.organizationId, id, { cost: canSeeCost }),
    getProduct(session.organizationId, id),
    listBrands(session.organizationId),
    listCategories(session.organizationId),
    listUnits(session.organizationId),
    listVariationHeads(session.organizationId),
  ]);
  if (!detail || !editable) {
    notFound();
  }
  const names = (rows: Array<{ id: string; name: string }>) => rows.map((row) => ({ id: row.id, name: row.name }));

  return (
    <div className="space-y-8">
      <PageHeader
        title={detail.name}
        description={`${detail.sku} · ${detail.status} · ${detail.isService ? "service" : `on hand ${detail.onHand}`}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: detail.name }]}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">General</h2>
        {canEdit ? (
          <ProductEditForm
            product={{
              id: detail.id,
              sku: detail.sku,
              name: detail.name,
              description: detail.description,
              genericName: detail.genericName,
              brandId: detail.brand?.id ?? null,
              categoryId: detail.category?.id ?? null,
              unitId: detail.unit?.id ?? null,
              vatType: detail.vatType,
              vatValue: detail.vatValue,
              sellingPrice: detail.sellingPrice,
              wholesalePrice: detail.wholesalePrice,
              minimumPrice: detail.minimumPrice,
              reorderLevel: detail.reorderLevel,
              isService: detail.isService,
              trackStock: detail.trackStock,
              trackExpiry: detail.trackExpiry,
              trackSerial: detail.trackSerial,
              warrantyAvailable: detail.warrantyAvailable,
              ...(canSeeCost && detail.cost ? { purchasePrice: detail.cost.purchasePrice } : {}),
            }}
            brands={names(brands)}
            categories={names(categories)}
            units={names(units)}
          />
        ) : (
          <dl className="grid max-w-xl grid-cols-2 gap-2 text-sm">
            <dt>Retail price</dt>
            <dd>{detail.sellingPrice}</dd>
            <dt>Wholesale price</dt>
            <dd>{detail.wholesalePrice}</dd>
            <dt>Minimum price</dt>
            <dd>{detail.minimumPrice}</dd>
            <dt>Category</dt>
            <dd>{detail.category?.name ?? "—"}</dd>
            <dt>Generic</dt>
            <dd>{detail.genericName ?? "—"}</dd>
          </dl>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Prices by level</h2>
        <p className="text-sm text-muted">A price starts at a quantity and holds until the next step. A level with no price for a quantity falls back to {detail.levels.find((level) => level.isDefault)?.level ?? "Retail"}. The price never goes below the minimum price ({detail.minimumPrice}).</p>
        {canEdit ? (
          <PriceStepsForm
            productId={detail.id}
            levels={detail.levels.map((level) => level.level)}
            initial={detail.levels.flatMap((level) => level.steps.map((step) => ({ level: level.level, minQty: step.minQty.replace(/\.?0+$/, "") || "1", price: step.price })))}
          />
        ) : (
          <DataTable
            caption="Prices by level"
            columns={[
              { key: "level", header: "Level", cell: (row) => row.level },
              { key: "steps", header: "Steps", cell: (row) => row.steps.map((step) => `${step.minQty.replace(/\.?0+$/, "")}+ = ${step.price}`).join(", ") || "—" },
            ]}
            rows={detail.levels}
            getRowKey={(row) => row.level}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Stock</h2>
        <DataTable
          caption="Stock by warehouse"
          columns={[
            { key: "branch", header: "Branch", cell: (row) => row.branchName },
            { key: "warehouse", header: "Warehouse", cell: (row) => row.warehouseName },
            { key: "quantity", header: "On hand", cell: (row) => row.quantity },
            { key: "reserved", header: "Reserved", cell: (row) => row.reserved },
          ]}
          rows={detail.stock}
          getRowKey={(row) => row.warehouseId}
        />
        {detail.cost ? (
          <p className="text-sm">
            Average cost {detail.cost.averageCost ?? "—"} · stock value {detail.cost.stockValue} · margin {detail.cost.marginPercent === null ? "—" : `${detail.cost.marginPercent}%`} (retail price less average cost)
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Barcodes</h2>
        <ul className="text-sm">
          {detail.barcodes.length === 0 ? <li className="text-muted">No barcode yet.</li> : detail.barcodes.map((barcode) => <li key={barcode.id}>{barcode.barcode}</li>)}
        </ul>
        {canEdit ? <BarcodeAddForm productId={detail.id} /> : null}
        <Link href="/products/barcodes" className="text-sm underline">
          Print labels
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Variants</h2>
        <DataTable
          caption="Variants"
          columns={[
            { key: "sku", header: "SKU", cell: (row) => row.sku },
            { key: "values", header: "Values", cell: (row) => row.values.join(", ") || "—" },
            { key: "price", header: "Own price", cell: (row) => row.price ?? "—" },
          ]}
          rows={detail.variants}
          getRowKey={(row) => row.id}
        />
        {session.permissions.has("products.create") ? <VariantAddForm productId={detail.id} heads={heads} /> : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Stock ledger</h2>
        <DataTable
          caption="Latest stock movements"
          columns={[
            { key: "date", header: "Date", cell: (row) => row.date },
            { key: "type", header: "Movement", cell: (row) => row.movementType },
            { key: "direction", header: "", cell: (row) => row.direction },
            { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
            { key: "warehouse", header: "Warehouse", cell: (row) => row.warehouseName },
          ]}
          rows={detail.ledger}
          getRowKey={(row) => row.id}
        />
        <Link href="/inventory/ledger" className="text-sm underline">
          Whole stock ledger
        </Link>
      </section>
    </div>
  );
}
