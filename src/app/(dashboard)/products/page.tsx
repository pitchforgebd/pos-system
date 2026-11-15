import Link from "next/link";
import { redirect } from "next/navigation";

import { ProductPhotoForm } from "@/components/catalog/product-photo";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { listCatalogTable } from "@/modules/catalog/products";

export async function generateMetadata() {
  return { title: (await getI18n("products")).t("products.title") };
}

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function pageNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageSize(value: string | undefined) {
  const parsed = Number(value);
  return parsed === 25 || parsed === 50 || parsed === 100 || parsed === 200 ? parsed : 25;
}

function listHref(input: { q: string; status: string; size: number; page: number }) {
  const params = new URLSearchParams();
  if (input.q) {
    params.set("q", input.q);
  }
  if (input.status) {
    params.set("status", input.status);
  }
  if (input.size !== 25) {
    params.set("size", String(input.size));
  }
  if (input.page > 1) {
    params.set("page", String(input.page));
  }
  const query = params.toString();
  return query ? `/products?${query}` : "/products";
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; size?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { t, taka, qty, count } = await getI18n("products");
  // What a product cost is only shown to someone who may see it (D20).
  const canSeeCost = session.permissions.has("products.cost");
  const canPhoto = session.permissions.has("products.edit") || session.permissions.has("products.create");
  const params = await searchParams;
  const q = clean(params.q);
  const status = params.status === "ACTIVE" || params.status === "INACTIVE" ? params.status : "";
  const size = pageSize(params.size);
  const table = await listCatalogTable(session.organizationId, {
    search: q,
    status,
    size,
    page: pageNumber(params.page),
  });
  const start = table.total === 0 ? 0 : (table.page - 1) * table.size + 1;
  const end = Math.min(table.page * table.size, table.total);
  const headers = [
    t("products.colNumber"),
    t("products.colInfo"),
    t("products.colImage"),
    ...(canSeeCost ? [t("products.colPurchase")] : []),
    t("products.colSelling"),
    t("products.colIn"),
    t("products.colOut"),
    t("products.colReturn"),
    t("products.colStock"),
    ...(canSeeCost ? [t("products.colStockValue")] : []),
    t("products.colSellingValue"),
    t("products.colAction"),
  ];
  const badge = (active: boolean) => (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${active ? "bg-success-subtle text-success" : "bg-error-subtle text-error"}`}>{active ? t("products.active") : t("products.inactive")}</span>
  );
  const photo = (row: { id: string; hasImage: boolean }) =>
    canPhoto ? (
      <ProductPhotoForm productId={row.id} hasImage={row.hasImage} />
    ) : row.hasImage ? (
      <img src={`/api/v1/products/${row.id}/image`} alt="" className="size-10 rounded-md object-cover" />
    ) : (
      <span className="text-xs text-muted">—</span>
    );

  // one provider for the whole list: the photo form of every row reads its texts from it
  return (
    <I18nBoundary areas={["products"]}>
    <div className="space-y-4">
      <PageHeader
        title={t("products.title")}
        description={t("products.description")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "All Products" }]}
        actions={session.permissions.has("products.create") ? <Button href="/products/new">{t("products.add")}</Button> : null}
      />
      <section className="rounded-2xl border border-border bg-surface p-4">
        <form className="flex flex-wrap items-end gap-2" action="/products">
          <label className="grid min-w-56 flex-1 gap-1 text-sm">
            {t("products.search")}
            <input name="q" defaultValue={q} placeholder={t("products.searchPlaceholder")} className="h-10 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1 text-sm">
            {t("products.status")}
            <select name="status" defaultValue={status} className="h-10 rounded-md border border-border bg-surface px-2">
              <option value="">{t("products.statusAll")}</option>
              <option value="ACTIVE">{t("products.active")}</option>
              <option value="INACTIVE">{t("products.inactive")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            {t("products.show")}
            <select name="size" defaultValue={String(size)} className="h-10 rounded-md border border-border bg-surface px-2">
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={String(n)}>
                  {count(n)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            {t("products.searchButton")}
          </Button>
        </form>
        <p className="mt-3 text-sm text-muted">{t("common.showing", { first: count(start), last: count(end), total: count(table.total) })}</p>

        {table.rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState title={t("products.emptyTitle")} description={t("products.emptyBody")} />
          </div>
        ) : (
          <>
            {/* a wide table where there is room */}
            <div className="mt-3 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[960px] border-collapse text-sm">
                <thead className="bg-surface-muted text-left text-xs text-muted">
                  <tr>
                    {headers.map((header) => (
                      <th key={header} className="px-2 py-2 font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-2 py-2">{count(start + index)}</td>
                      <td className="px-2 py-2">
                        <Link href={`/products/${row.id}`} className="block font-medium underline-offset-2 hover:underline">
                          {row.name}
                        </Link>
                        <span className="text-xs text-muted">{row.sku}</span> {badge(row.status === "ACTIVE")}
                      </td>
                      <td className="px-2 py-2">{photo(row)}</td>
                      {canSeeCost ? <td className="px-2 py-2 tabular-nums">{taka(row.purchasePrice)}</td> : null}
                      <td className="px-2 py-2 tabular-nums">{taka(row.sellingPrice)}</td>
                      <td className="px-2 py-2 tabular-nums">{qty(row.stockIn)}</td>
                      <td className="px-2 py-2 tabular-nums">{qty(row.stockOut)}</td>
                      <td className="px-2 py-2 tabular-nums">{qty(row.totalReturn)}</td>
                      <td className="px-2 py-2 tabular-nums">{qty(row.currentStock)}</td>
                      {canSeeCost ? <td className="px-2 py-2 tabular-nums">{taka(row.stockValue)}</td> : null}
                      <td className="px-2 py-2 tabular-nums">{taka(row.sellingValue)}</td>
                      <td className="px-2 py-2">
                        <Link href="/inventory/ledger" className="text-info">
                          {t("products.ledger")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* a card for each product on a phone: the name first, then the numbers that matter at the shelf */}
            <ul className="mt-3 space-y-3 md:hidden">
              {table.rows.map((row) => (
                <li key={row.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/products/${row.id}`} className="block font-semibold">
                        {row.name}
                      </Link>
                      <span className="text-xs text-muted">{row.sku}</span> {badge(row.status === "ACTIVE")}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums">{taka(row.sellingPrice)}</p>
                      <p className="text-xs text-muted">{t("products.colStock")}: {qty(row.currentStock)}</p>
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {canSeeCost ? (
                      <>
                        <dt className="text-muted">{t("products.colPurchase")}</dt>
                        <dd className="text-right tabular-nums">{taka(row.purchasePrice)}</dd>
                      </>
                    ) : null}
                    <dt className="text-muted">{t("products.colIn")}</dt>
                    <dd className="text-right tabular-nums">{qty(row.stockIn)}</dd>
                    <dt className="text-muted">{t("products.colOut")}</dt>
                    <dd className="text-right tabular-nums">{qty(row.stockOut)}</dd>
                  </dl>
                  <div className="mt-2">{photo(row)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          {table.page > 1 ? (
            <Link href={listHref({ q, status, size, page: table.page - 1 })} className="rounded-md border border-border px-3 py-1.5 text-sm">
              {t("common.previous")}
            </Link>
          ) : null}
          <span className="text-sm text-muted">
            {count(table.page)} / {count(table.pageCount)}
          </span>
          {table.page < table.pageCount ? (
            <Link href={listHref({ q, status, size, page: table.page + 1 })} className="rounded-md border border-border px-3 py-1.5 text-sm">
              {t("common.next")}
            </Link>
          ) : null}
        </div>
      </section>
    </div>
    </I18nBoundary>
  );
}
