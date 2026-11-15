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
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Product");

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ph = await getPhrase();
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
        <h2 className="text-lg font-semibold">{ph("General")}</h2>
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
            <dt>{ph("Retail price")}</dt>
            <dd>{detail.sellingPrice}</dd>
            <dt>{ph("Wholesale price")}</dt>
            <dd>{detail.wholesalePrice}</dd>
            <dt>{ph("Minimum price")}</dt>
            <dd>{detail.minimumPrice}</dd>
            <dt>{ph("Category")}</dt>
            <dd>{detail.category?.name ?? "—"}</dd>
            <dt>{ph("Generic")}</dt>
            <dd>{detail.genericName ?? "—"}</dd>
          </dl>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{ph("Prices by level")}</h2>
        <p className="text-sm text-muted">{ph("A price starts at a quantity and holds until the next step. A level with no price for a quantity falls back to")} {detail.levels.find((level) => level.isDefault)?.level ?? ph("Retail")}{ph(". The price never goes below the minimum price (")}{detail.minimumPrice}).</p>
        {canEdit ? (
          <PriceStepsForm
            productId={detail.id}
            levels={detail.levels.map((level) => level.level)}
            initial={detail.levels.flatMap((level) => level.steps.map((step) => ({ level: level.level, minQty: step.minQty.replace(/\.?0+$/, "") || "1", price: step.price })))}
          />
        ) : (
          <DataTable
            caption={ph("Prices by level")}
            columns={[
              { key: "level", header: ph("Level"), cell: (row) => row.level },
              { key: "steps", header: ph("Steps"), cell: (row) => row.steps.map((step) => `${step.minQty.replace(/\.?0+$/, "")}+ = ${step.price}`).join(", ") || "—" },
            ]}
            rows={detail.levels}
            getRowKey={(row) => row.level}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{ph("Stock")}</h2>
        <DataTable
          caption={ph("Stock by warehouse")}
          columns={[
            { key: "branch", header: ph("Branch"), cell: (row) => row.branchName },
            { key: "warehouse", header: ph("Warehouse"), cell: (row) => row.warehouseName },
            { key: "quantity", header: ph("On hand"), cell: (row) => row.quantity },
            { key: "reserved", header: ph("Reserved"), cell: (row) => row.reserved },
          ]}
          rows={detail.stock}
          getRowKey={(row) => row.warehouseId}
        />
        {detail.cost ? (
          <p className="text-sm">
            {ph("Average cost")} {detail.cost.averageCost ?? "—"} {ph("· stock value")} {detail.cost.stockValue} {ph("· margin")} {detail.cost.marginPercent === null ? "—" : `${detail.cost.marginPercent}%`} {ph("(retail price less average cost)")}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{ph("Barcodes")}</h2>
        <ul className="text-sm">
          {detail.barcodes.length === 0 ? <li className="text-muted">{ph("No barcode yet.")}</li> : detail.barcodes.map((barcode) => <li key={barcode.id}>{barcode.barcode}</li>)}
        </ul>
        {canEdit ? <BarcodeAddForm productId={detail.id} /> : null}
        <Link href="/products/barcodes" className="text-sm underline">
          {ph("Print labels")}
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{ph("Variants")}</h2>
        <DataTable
          caption={ph("Variants")}
          columns={[
            { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
            { key: "values", header: ph("Values"), cell: (row) => row.values.join(", ") || "—" },
            { key: "price", header: ph("Own price"), cell: (row) => row.price ?? "—" },
          ]}
          rows={detail.variants}
          getRowKey={(row) => row.id}
        />
        {session.permissions.has("products.create") ? <VariantAddForm productId={detail.id} heads={heads} /> : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{ph("Stock ledger")}</h2>
        <DataTable
          caption={ph("Latest stock movements")}
          columns={[
            { key: "date", header: ph("Date"), cell: (row) => row.date },
            { key: "type", header: ph("Movement"), cell: (row) => row.movementType },
            { key: "direction", header: "", cell: (row) => row.direction },
            { key: "quantity", header: ph("Quantity"), cell: (row) => row.quantity },
            { key: "warehouse", header: ph("Warehouse"), cell: (row) => row.warehouseName },
          ]}
          rows={detail.ledger}
          getRowKey={(row) => row.id}
        />
        <Link href="/inventory/ledger" className="text-sm underline">
          {ph("Whole stock ledger")}
        </Link>
      </section>
    </div>
  );
}
