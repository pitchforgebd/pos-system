import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrderActions } from "@/components/orders/order-actions";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { customerWallet } from "@/modules/customers/customers";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { getOrder } from "@/modules/orders/orders";
import { listCouriers } from "@/modules/shipping/couriers";

export const metadata = { title: "Order" };

const TONE = { DRAFT: "neutral", CONFIRMED: "info", PACKED: "info", DISPATCHED: "warning", DELIVERED: "success", CANCELLED: "error", RETURNED: "error" } as const;

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const order = await getOrder(session.organizationId, session.branchId, id);
  if (!order) {
    notFound();
  }
  const advance = (await customerWallet(session.organizationId, order.customer.id)).toFixed(2);
  const couriers = order.deliveryMethod === "COURIER" && order.status !== "DISPATCHED" ? (await listCouriers(session.organizationId)).filter((courier) => courier.status === "ACTIVE") : [];
  const title = order.number ?? order.quotationNumber ?? "Draft order";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${order.isQuotation && order.status === "DRAFT" ? "Quotation " : ""}${title}`}
        description={`${order.customer.name}${order.customer.phone ? ` · ${order.customer.phone}` : ""} · ${order.businessDate} · ${order.channel.toLowerCase()}${order.externalRef ? ` (${order.externalRef})` : ""}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Orders", href: "/orders" }, { label: title }]}
        actions={<StatusBadge tone={TONE[order.status]}>{order.status}</StatusBadge>}
      />
      <OrderActions id={order.id} status={order.status} today={businessDate()} advance={advance} can={{ create: session.permissions.has("orders.create"), manage: session.permissions.has("orders.manage") }} deliveryMethod={order.deliveryMethod} couriers={couriers} shipment={order.shipment} />
      {order.invoice ? (
        <p className="text-sm">
          Invoice <Link href={`/sales/${order.invoice.id}`}>{order.invoice.number}</Link>
        </p>
      ) : null}
      <DataTable
        caption="Order lines"
        columns={[
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
          { key: "price", header: "Price", cell: (row) => row.unitPrice },
          { key: "discount", header: "Discount", cell: (row) => row.discountAmount },
          { key: "vat", header: "VAT", cell: (row) => row.vatAmount },
          { key: "total", header: "Line total", cell: (row) => row.lineTotal },
        ]}
        rows={order.items}
        getRowKey={(row) => row.id}
      />
      <dl className="grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt>Goods</dt>
        <dd className="text-right tabular-nums">{order.subtotal}</dd>
        <dt>Discounts</dt>
        <dd className="text-right tabular-nums">{order.discountTotal}</dd>
        <dt>VAT</dt>
        <dd className="text-right tabular-nums">{order.vatTotal}</dd>
        <dt>Delivery and other charges</dt>
        <dd className="text-right tabular-nums">{order.chargesTotal}</dd>
        <dt className="font-medium">Total</dt>
        <dd className="text-right font-medium tabular-nums">{order.total}</dd>
      </dl>
      {order.shippingAddress ? <p className="text-sm">Deliver to: {order.shippingAddress}</p> : null}
      {order.shipment ? (
        <p className="text-sm">
          Shipment <Link href={`/shipments/${order.shipment.id}`}>{order.shipment.number}</Link> ({order.shipment.status.toLowerCase().replace("_", " ")})
        </p>
      ) : null}
      {order.note ? <p className="text-sm">{order.note}</p> : null}
      <section aria-label="History">
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <ol className="space-y-1 text-sm">
          {order.events.map((event) => (
            <li key={event.id}>
              <span className="text-muted">{event.at.slice(0, 16).replace("T", " ")}</span> · {event.from ? `${event.from} → ` : ""}
              <strong>{event.to}</strong>
              {event.by ? ` · ${event.by}` : ""}
              {event.note ? ` · ${event.note}` : ""}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
