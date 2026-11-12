import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { listQuery } from "@/core/list";
import { getSession } from "@/modules/auth/current-session";
import { listOrders, orderBoard, orderSorts } from "@/modules/orders/orders";

export const metadata = { title: "Orders" };

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
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="An order is confirmed (the stock is held), packed, dispatched (the invoice is made and the stock goes out), then delivered. Cancel it before the dispatch; after it, return the goods."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Orders" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" href={board ? "/orders" : "/orders?view=board"}>{board ? "List" : "Board"}</Button>
            {session.permissions.has("orders.create") ? <Button href="/orders/new">New order</Button> : null}
          </div>
        }
      />
      <form className="flex flex-wrap items-end gap-2" action="/orders">
        {board ? <input type="hidden" name="view" value="board" /> : null}
        {!board ? (
          <label className="grid min-w-56 flex-1 gap-1 text-sm">
            Search
            <input name="q" defaultValue={params.q ?? ""} placeholder="Order, customer, phone or reference" className="h-10 rounded-md border border-border px-3" />
          </label>
        ) : null}
        {!board ? (
          <label className="grid gap-1 text-sm">
            Status
            <select name="status" defaultValue={status ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
              <option value="">All</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0) + value.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="grid gap-1 text-sm">
          Channel
          <select name="channel" defaultValue={channel ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All</option>
            {CHANNELS.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        {!board ? (
          <>
            <label className="grid gap-1 text-sm">
              From
              <input name="from" type="date" defaultValue={filter.from ?? ""} className="h-10 rounded-md border border-border px-2" />
            </label>
            <label className="grid gap-1 text-sm">
              To
              <input name="to" type="date" defaultValue={filter.to ?? ""} className="h-10 rounded-md border border-border px-2" />
            </label>
          </>
        ) : null}
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {board ? (
        <div className="grid gap-4 md:grid-cols-5" aria-label="Order board">
          {columns.map((column) => (
            <section key={column.status} className="rounded-md border border-border p-2">
              <h2 className="flex items-center justify-between text-sm font-semibold">
                <span>{column.status.charAt(0) + column.status.slice(1).toLowerCase()}</span>
                <span className="text-muted">{column.count}</span>
              </h2>
              <ul className="mt-2 space-y-2">
                {column.cards.map((card) => (
                  <li key={card.id} className="rounded-md border border-border bg-surface p-2 text-sm">
                    <Link href={`/orders/${card.id}`} className="font-medium">
                      {card.number ?? "Draft"}
                    </Link>
                    <div>{card.customerName}</div>
                    <div className="text-muted">
                      {card.total} · {card.channel.toLowerCase()}
                      {card.expectedDate ? ` · by ${card.expectedDate}` : ""}
                    </div>
                  </li>
                ))}
                {column.count > column.cards.length ? (
                  <li className="text-xs text-muted">
                    <Link href={`/orders?status=${column.status}`}>All {column.count} →</Link>
                  </li>
                ) : null}
              </ul>
            </section>
          ))}
        </div>
      ) : list ? (
        <>
          <DataTable
            caption="Orders"
            columns={[
              { key: "number", header: "Order", cell: (row) => <Link href={`/orders/${row.id}`}>{row.number ?? "Draft"}</Link> },
              { key: "date", header: "Date", cell: (row) => row.businessDate },
              { key: "customer", header: "Customer", cell: (row) => row.customerName },
              { key: "channel", header: "Channel", cell: (row) => row.channel.toLowerCase() },
              { key: "expected", header: "Expected", cell: (row) => row.expectedDate ?? "" },
              { key: "total", header: "Total", cell: (row) => row.total },
              { key: "status", header: "Status", cell: (row) => <StatusBadge tone={TONE[row.status]}>{row.status}</StatusBadge> },
            ]}
            rows={list.rows}
            getRowKey={(row) => row.id}
            empty={<EmptyState title="No orders" description="Write an order down, or confirm a quotation." />}
          />
          {list.page.total > list.page.pageSize ? <Pagination page={list.page.page} pageCount={list.page.pageCount} total={list.page.total} pageSize={list.page.pageSize} path="/orders" params={keep} /> : null}
        </>
      ) : null}
    </div>
  );
}
