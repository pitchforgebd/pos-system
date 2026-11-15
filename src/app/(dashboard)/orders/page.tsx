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
import { listOrders, orderBoard, orderSorts } from "@/modules/orders/orders";

export const generateMetadata = titled("orders", "orders.title");

const STATUSES = ["DRAFT", "CONFIRMED", "PACKED", "DISPATCHED", "DELIVERED", "CANCELLED", "RETURNED"] as const;
const CHANNELS = ["POS", "PHONE", "FACEBOOK", "WEBSITE", "OTHER"] as const;
const TONE = { DRAFT: "neutral", CONFIRMED: "info", PACKED: "info", DISPATCHED: "warning", DELIVERED: "success", CANCELLED: "error", RETURNED: "error" } as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Search = { view?: string; q?: string; status?: string; channel?: string; from?: string; to?: string; page?: string; pageSize?: string; sort?: string };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { t, taka, date, count } = await getI18n("orders");
  const params = await searchParams;
  const status = STATUSES.find((value) => value === params.status);
  const channel = CHANNELS.find((value) => value === params.channel);
  const board = params.view === "board";
  const filter = { status, channel, q: params.q, from: params.from && ISO.test(params.from) ? params.from : undefined, to: params.to && ISO.test(params.to) ? params.to : undefined, quotations: false };
  const [columns, list] = await Promise.all([
    board ? orderBoard(session.organizationId, session.branchId, { channel }) : Promise.resolve([]),
    board ? Promise.resolve(null) : listOrders(session.organizationId, session.branchId, listQuery(params, { sorts: orderSorts }), filter),
  ]);
  const keep = { ...(params.q ? { q: params.q } : {}), ...(status ? { status } : {}), ...(channel ? { channel } : {}), ...(filter.from ? { from: filter.from } : {}), ...(filter.to ? { to: filter.to } : {}) };

  return (
    <I18nBoundary areas={["orders"]}>
      <div className="space-y-6">
        <PageHeader
          title={t("orders.title")}
          description={t("orders.description")}
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Orders" }]}
          actions={
            <div className="flex gap-2">
              <Button variant="secondary" href={board ? "/orders" : "/orders?view=board"}>
                {board ? t("orders.list") : t("orders.board")}
              </Button>
              {session.permissions.has("orders.create") ? <Button href="/orders/new">{t("orders.new")}</Button> : null}
            </div>
          }
        />
        <form className="flex flex-wrap items-end gap-2" action="/orders">
          {board ? <input type="hidden" name="view" value="board" /> : null}
          {!board ? (
            <label className="grid min-w-56 flex-1 gap-1 text-sm">
              {t("orders.search")}
              <input name="q" defaultValue={params.q ?? ""} placeholder={t("orders.searchPlaceholder")} className="h-10 rounded-md border border-border px-3" />
            </label>
          ) : null}
          {!board ? (
            <label className="grid gap-1 text-sm">
              {t("orders.status")}
              <select name="status" defaultValue={status ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
                <option value="">{t("orders.all")}</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`orders.status.${value}` as const)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-sm">
            {t("orders.channel")}
            <select name="channel" defaultValue={channel ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
              <option value="">{t("orders.all")}</option>
              {CHANNELS.map((value) => (
                <option key={value} value={value}>
                  {t(`orders.channel.${value}` as const)}
                </option>
              ))}
            </select>
          </label>
          {!board ? (
            <>
              <label className="grid gap-1 text-sm">
                {t("orders.from")}
                <input name="from" type="date" defaultValue={filter.from ?? ""} className="h-10 rounded-md border border-border px-2" />
              </label>
              <label className="grid gap-1 text-sm">
                {t("orders.to")}
                <input name="to" type="date" defaultValue={filter.to ?? ""} className="h-10 rounded-md border border-border px-2" />
              </label>
            </>
          ) : null}
          <Button type="submit" variant="secondary">
            {t("orders.filter")}
          </Button>
        </form>

        {board ? (
          <div className="grid gap-4 md:grid-cols-5" aria-label={t("orders.boardLabel")}>
            {columns.map((column) => (
              <section key={column.status} className="rounded-md border border-border p-2">
                <h2 className="flex items-center justify-between text-sm font-semibold">
                  <span>{t(`orders.status.${column.status}` as const)}</span>
                  <span className="text-muted">{count(column.count)}</span>
                </h2>
                <ul className="mt-2 space-y-2">
                  {column.cards.map((card) => (
                    <li key={card.id} className="rounded-md border border-border bg-surface p-2 text-sm">
                      <Link href={`/orders/${card.id}`} className="font-medium">
                        {card.number ?? t("orders.draft")}
                      </Link>
                      <div>{card.customerName}</div>
                      <div className="text-muted">
                        {taka(card.total)} · {t(`orders.channel.${card.channel}` as const)}
                        {card.expectedDate ? ` · ${t("orders.byDate", { date: date(card.expectedDate) })}` : ""}
                      </div>
                    </li>
                  ))}
                  {column.count > column.cards.length ? (
                    <li className="text-xs text-muted">
                      <Link href={`/orders?status=${column.status}`}>{t("orders.allInColumn", { n: count(column.count) })}</Link>
                    </li>
                  ) : null}
                </ul>
              </section>
            ))}
          </div>
        ) : list ? (
          <>
            <DataTable
              caption={t("orders.caption")}
              columns={[
                { key: "number", header: t("orders.colOrder"), cell: (row) => <Link href={`/orders/${row.id}`}>{row.number ?? t("orders.draft")}</Link> },
                { key: "date", header: t("orders.colDate"), cell: (row) => date(row.businessDate) },
                { key: "customer", header: t("orders.colCustomer"), cell: (row) => row.customerName },
                { key: "channel", header: t("orders.colChannel"), cell: (row) => t(`orders.channel.${row.channel}` as const) },
                { key: "expected", header: t("orders.colExpected"), cell: (row) => (row.expectedDate ? date(row.expectedDate) : "") },
                { key: "total", header: t("orders.colTotal"), cell: (row) => taka(row.total) },
                { key: "status", header: t("orders.colStatus"), cell: (row) => <StatusBadge tone={TONE[row.status]}>{t(`orders.status.${row.status}` as const)}</StatusBadge> },
              ]}
              rows={list.rows}
              getRowKey={(row) => row.id}
              empty={<EmptyState title={t("orders.emptyTitle")} description={t("orders.emptyBody")} />}
            />
            {list.page.total > list.page.pageSize ? <Pagination page={list.page.page} pageCount={list.page.pageCount} total={list.page.total} pageSize={list.page.pageSize} path="/orders" params={keep} /> : null}
          </>
        ) : null}
      </div>
    </I18nBoundary>
  );
}
