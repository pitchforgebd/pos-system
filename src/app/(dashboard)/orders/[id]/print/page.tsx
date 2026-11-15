import { notFound, redirect } from "next/navigation";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { titled } from "@/lib/i18n/metadata";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { getOrder } from "@/modules/orders/orders";

export const generateMetadata = titled("orders", "orders.print");

export default async function OrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const order = await getOrder(session.organizationId, session.branchId, id);
  if (!order) {
    notFound();
  }
  const { t, taka, date, qty } = await getI18n("orders");
  const quote = order.isQuotation && order.status === "DRAFT";
  const title = (quote ? t("orders.printQuotation", { number: order.quotationNumber ?? "" }) : t("orders.printOrder", { number: order.number ?? "" })).trim();

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Orders", href: "/orders" }, { label: order.number ?? order.quotationNumber ?? t("orders.colOrder"), href: `/orders/${id}` }, { label: "Print" }]}
        actions={<PrintButton label={t("orders.print")} />}
      />
      <PrintSheet title={title} note={`${order.customer.name}${order.customer.phone ? ` · ${order.customer.phone}` : ""} · ${date(order.businessDate)}${quote && order.validUntil ? ` · ${t("orders.validUntilNote", { date: date(order.validUntil) })}` : ""}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-1">{t("orders.product")}</th>
              <th className="py-1 text-right">{t("orders.quantity")}</th>
              <th className="py-1 text-right">{t("orders.price")}</th>
              <th className="py-1 text-right">{t("orders.discount")}</th>
              <th className="py-1 text-right">{t("orders.colTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="py-1">
                  {item.sku} · {item.name}
                </td>
                <td className="py-1 text-right tabular-nums">{qty(item.quantity)}</td>
                <td className="py-1 text-right tabular-nums">{taka(item.unitPrice)}</td>
                <td className="py-1 text-right tabular-nums">{taka(item.discountAmount)}</td>
                <td className="py-1 text-right tabular-nums">{taka(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-4 text-sm">
          <dt>{t("orders.goods")}</dt>
          <dd className="text-right tabular-nums">{taka(order.subtotal)}</dd>
          <dt>{t("orders.discounts")}</dt>
          <dd className="text-right tabular-nums">{taka(order.discountTotal)}</dd>
          <dt>{t("orders.vat")}</dt>
          <dd className="text-right tabular-nums">{taka(order.vatTotal)}</dd>
          <dt>{t("orders.chargesShort")}</dt>
          <dd className="text-right tabular-nums">{taka(order.chargesTotal)}</dd>
          <dt className="font-semibold">{t("orders.total")}</dt>
          <dd className="text-right font-semibold tabular-nums">{taka(order.total)}</dd>
        </dl>
        {order.shippingAddress ? <p>{t("orders.deliverTo", { address: order.shippingAddress })}</p> : null}
        {order.note ? <p>{order.note}</p> : null}
      </PrintSheet>
    </div>
  );
}
