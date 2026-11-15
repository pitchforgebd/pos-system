import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrderActions } from "@/components/orders/order-actions";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { businessDate } from "@/core/time/business-date";
import { titled } from "@/lib/i18n/metadata";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { customerWallet } from "@/modules/customers/customers";
import { getOrder } from "@/modules/orders/orders";
import { listCouriers } from "@/modules/shipping/couriers";

export const generateMetadata = titled("orders", "orders.colOrder");

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
  const { t, taka, date, qty, dateTime } = await getI18n("orders");
  const advance = (await customerWallet(session.organizationId, order.customer.id)).toFixed(2);
  const couriers = order.deliveryMethod === "COURIER" && order.status !== "DISPATCHED" ? (await listCouriers(session.organizationId)).filter((courier) => courier.status === "ACTIVE") : [];
  const title = order.number ?? order.quotationNumber ?? t("orders.draftOrder");
  const status = (value: keyof typeof TONE) => t(`orders.status.${value}` as const);

  return (
    <I18nBoundary areas={["orders"]}>
      <div className="space-y-6">
        <PageHeader
          title={`${order.isQuotation && order.status === "DRAFT" ? `${t("orders.quotation")} ` : ""}${title}`}
          description={t("orders.detailLine", {
            customer: order.customer.name,
            phone: order.customer.phone ? ` · ${order.customer.phone}` : "",
            date: date(order.businessDate),
            channel: t(`orders.channel.${order.channel}` as const),
            ref: order.externalRef ? ` (${order.externalRef})` : "",
          })}
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Orders", href: "/orders" }, { label: title }]}
          actions={<StatusBadge tone={TONE[order.status]}>{status(order.status)}</StatusBadge>}
        />
        <OrderActions
          id={order.id}
          status={order.status}
          today={businessDate()}
          advance={taka(advance)}
          can={{ create: session.permissions.has("orders.create"), manage: session.permissions.has("orders.manage") }}
          deliveryMethod={order.deliveryMethod}
          couriers={couriers}
          shipment={order.shipment}
        />
        {order.invoice ? (
          <p className="text-sm">
            {t("orders.invoice")} <Link href={`/sales/${order.invoice.id}`}>{order.invoice.number}</Link>
          </p>
        ) : null}
        <DataTable
          caption={t("orders.linesCaption")}
          columns={[
            { key: "sku", header: t("orders.sku"), cell: (row) => row.sku },
            { key: "name", header: t("orders.product"), cell: (row) => row.name },
            { key: "quantity", header: t("orders.quantity"), cell: (row) => qty(row.quantity) },
            { key: "price", header: t("orders.price"), cell: (row) => taka(row.unitPrice) },
            { key: "discount", header: t("orders.discount"), cell: (row) => taka(row.discountAmount) },
            { key: "vat", header: t("orders.vat"), cell: (row) => taka(row.vatAmount) },
            { key: "total", header: t("orders.lineTotal"), cell: (row) => taka(row.lineTotal) },
          ]}
          rows={order.items}
          getRowKey={(row) => row.id}
        />
        <dl className="grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt>{t("orders.goods")}</dt>
          <dd className="text-right tabular-nums">{taka(order.subtotal)}</dd>
          <dt>{t("orders.discounts")}</dt>
          <dd className="text-right tabular-nums">{taka(order.discountTotal)}</dd>
          <dt>{t("orders.vat")}</dt>
          <dd className="text-right tabular-nums">{taka(order.vatTotal)}</dd>
          <dt>{t("orders.charges")}</dt>
          <dd className="text-right tabular-nums">{taka(order.chargesTotal)}</dd>
          <dt className="font-medium">{t("orders.total")}</dt>
          <dd className="text-right font-medium tabular-nums">{taka(order.total)}</dd>
        </dl>
        {order.shippingAddress ? <p className="text-sm">{t("orders.deliverTo", { address: order.shippingAddress })}</p> : null}
        {order.shipment ? (
          <p className="text-sm">
            {t("orders.shipment")} <Link href={`/shipments/${order.shipment.id}`}>{order.shipment.number}</Link> ({order.shipment.status.toLowerCase().replace("_", " ")})
          </p>
        ) : null}
        {order.note ? <p className="text-sm">{order.note}</p> : null}
        <section aria-label={t("orders.history")}>
          <h2 className="mb-2 text-sm font-semibold">{t("orders.history")}</h2>
          <ol className="space-y-1 text-sm">
            {order.events.map((event) => (
              <li key={event.id}>
                <span className="text-muted">{dateTime(event.at)}</span> · {event.from ? `${status(event.from as keyof typeof TONE)} → ` : ""}
                <strong>{status(event.to as keyof typeof TONE)}</strong>
                {event.by ? ` · ${event.by}` : ""}
                {event.note ? ` · ${event.note}` : ""}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </I18nBoundary>
  );
}
