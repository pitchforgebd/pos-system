import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { listQuery } from "@/core/list";
import { titled } from "@/lib/i18n/metadata";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { listOrders, orderSorts } from "@/modules/orders/orders";

export const generateMetadata = titled("orders", "orders.quotesTitle");

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; pageSize?: string; sort?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { t, taka, date } = await getI18n("orders");
  const params = await searchParams;
  const { rows, page } = await listOrders(session.organizationId, session.branchId, listQuery(params, { sorts: orderSorts }), { quotations: true, q: params.q });

  return (
    <I18nBoundary areas={["orders"]}>
      <div className="space-y-6">
        <PageHeader
          title={t("orders.quotesTitle")}
          description={t("orders.quotesDescription")}
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Quotations" }]}
          actions={<Button href="/orders/new?quotation=1">{t("orders.newQuotation")}</Button>}
        />
        <form className="flex flex-wrap items-end gap-2" action="/quotations">
          <label className="grid min-w-56 flex-1 gap-1 text-sm">
            {t("orders.search")}
            <input name="q" defaultValue={params.q ?? ""} placeholder={t("orders.quotesSearch")} className="h-10 rounded-md border border-border px-3" />
          </label>
          <Button type="submit" variant="secondary">
            {t("orders.search")}
          </Button>
        </form>
        <DataTable
          caption={t("orders.quotesCaption")}
          columns={[
            { key: "number", header: t("orders.quotesNumber"), cell: (row) => <Link href={`/orders/${row.id}`}>{row.quotationNumber ?? t("orders.quotesNumber")}</Link> },
            { key: "date", header: t("orders.colDate"), cell: (row) => date(row.businessDate) },
            { key: "customer", header: t("orders.colCustomer"), cell: (row) => row.customerName },
            { key: "total", header: t("orders.colTotal"), cell: (row) => taka(row.total) },
            { key: "status", header: t("orders.colStatus"), cell: (row) => <StatusBadge tone={row.status === "DRAFT" ? "neutral" : "success"}>{row.status === "DRAFT" ? t("orders.quotesOpen") : t("orders.quotesConfirmed", { number: row.number ?? "" })}</StatusBadge> },
          ]}
          rows={rows}
          getRowKey={(row) => row.id}
          empty={<EmptyState title={t("orders.quotesEmptyTitle")} description={t("orders.quotesEmptyBody")} />}
        />
        {page.total > page.pageSize ? <Pagination page={page.page} pageCount={page.pageCount} total={page.total} pageSize={page.pageSize} path="/quotations" params={params.q ? { q: params.q } : {}} /> : null}
      </div>
    </I18nBoundary>
  );
}
