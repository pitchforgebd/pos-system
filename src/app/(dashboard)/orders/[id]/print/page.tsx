import { notFound, redirect } from "next/navigation";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getOrder } from "@/modules/orders/orders";

export const metadata = { title: "Order print" };

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
  const quote = order.isQuotation && order.status === "DRAFT";
  const title = quote ? `Quotation ${order.quotationNumber ?? ""}` : `Order ${order.number ?? ""}`;

  return (
    <div className="space-y-4">
      <PageHeader title={title.trim()} breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Orders", href: "/orders" }, { label: order.number ?? order.quotationNumber ?? "Order", href: `/orders/${id}` }, { label: "Print" }]} actions={<PrintButton label="Print" />} />
      <PrintSheet title={title.trim()} note={`${order.customer.name}${order.customer.phone ? ` · ${order.customer.phone}` : ""} · ${order.businessDate}${quote && order.validUntil ? ` · valid until ${order.validUntil}` : ""}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-1">Product</th>
              <th className="py-1 text-right">Quantity</th>
              <th className="py-1 text-right">Price</th>
              <th className="py-1 text-right">Discount</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="py-1">
                  {item.sku} · {item.name}
                </td>
                <td className="py-1 text-right tabular-nums">{item.quantity}</td>
                <td className="py-1 text-right tabular-nums">{item.unitPrice}</td>
                <td className="py-1 text-right tabular-nums">{item.discountAmount}</td>
                <td className="py-1 text-right tabular-nums">{item.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-4 text-sm">
          <dt>Goods</dt>
          <dd className="text-right tabular-nums">{order.subtotal}</dd>
          <dt>Discounts</dt>
          <dd className="text-right tabular-nums">{order.discountTotal}</dd>
          <dt>VAT</dt>
          <dd className="text-right tabular-nums">{order.vatTotal}</dd>
          <dt>Charges</dt>
          <dd className="text-right tabular-nums">{order.chargesTotal}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold tabular-nums">{order.total}</dd>
        </dl>
        {order.shippingAddress ? <p>Deliver to: {order.shippingAddress}</p> : null}
        {order.note ? <p>{order.note}</p> : null}
      </PrintSheet>
    </div>
  );
}
