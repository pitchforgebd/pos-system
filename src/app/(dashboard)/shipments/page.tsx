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
import { listCouriers } from "@/modules/shipping/couriers";
import { listShipments, shipmentSorts } from "@/modules/shipping/shipments";

export const metadata = { title: "Shipments" };

const STATUSES = ["CREATED", "PICKED", "IN_TRANSIT", "DELIVERED", "RETURNED", "LOST"] as const;
const TONE = { CREATED: "neutral", PICKED: "info", IN_TRANSIT: "info", DELIVERED: "success", RETURNED: "error", LOST: "error" } as const;

type Search = { q?: string; status?: string; courierId?: string; page?: string; pageSize?: string; sort?: string };

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const status = STATUSES.find((value) => value === params.status);
  const courierId = params.courierId && /^[0-9a-f-]{36}$/i.test(params.courierId) ? params.courierId : undefined;
  const [couriers, { rows, page }] = await Promise.all([
    listCouriers(session.organizationId),
    listShipments(session.organizationId, session.branchId, listQuery(params, { sorts: shipmentSorts }), { status, courierId, q: params.q }),
  ]);
  const keep = { ...(params.q ? { q: params.q } : {}), ...(status ? { status } : {}), ...(courierId ? { courierId } : {}) };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipments"
        description="A shipment is made when an order is dispatched: by the shop's vehicle, or by courier, which collects the customer's cash and owes it to the shop until it settles."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Shipments" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" href="/couriers">
              Courier dues
            </Button>
            <Button variant="secondary" href="/orders">
              Orders
            </Button>
          </div>
        }
      />
      <form className="flex flex-wrap items-end gap-2" action="/shipments">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Number, tracking code, vehicle or customer" className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          Status
          <select name="status" defaultValue={status ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase().replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Courier
          <select name="courierId" defaultValue={courierId ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All</option>
            {couriers.map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <DataTable
        caption="Shipments"
        columns={[
          { key: "number", header: "Shipment", cell: (row) => <Link href={`/shipments/${row.id}`}>{row.number ?? "Shipment"}</Link> },
          { key: "date", header: "Sent", cell: (row) => row.dispatchedOn ?? "" },
          { key: "customer", header: "Customer", cell: (row) => row.customerName ?? "" },
          { key: "by", header: "By", cell: (row) => row.courierName ?? "Own vehicle" },
          { key: "tracking", header: "Tracking", cell: (row) => row.trackingCode ?? "" },
          { key: "cod", header: "Cash to collect", cell: (row) => row.codAmount },
          { key: "status", header: "Status", cell: (row) => <StatusBadge tone={TONE[row.status]}>{row.status.replace("_", " ")}</StatusBadge> },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No shipments" description="Dispatch an order that goes by courier or by the shop's vehicle." />}
      />
      {page.total > page.pageSize ? <Pagination page={page.page} pageCount={page.pageCount} total={page.total} pageSize={page.pageSize} path="/shipments" params={keep} /> : null}
    </div>
  );
}
