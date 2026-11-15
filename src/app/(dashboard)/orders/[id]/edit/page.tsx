import { notFound, redirect } from "next/navigation";

import { OrderForm, type OrderFormValues } from "@/components/orders/order-form";
import { PageHeader } from "@/components/ui/page-header";
import { businessDate } from "@/core/time/business-date";
import { titled } from "@/lib/i18n/metadata";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { getOrder } from "@/modules/orders/orders";
import { listPriceLevels } from "@/modules/pricing/admin";

export const generateMetadata = titled("orders", "orders.crumbChange");

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId || !session.permissions.has("orders.create")) {
    redirect("/orders");
  }
  const { id } = await params;
  const order = await getOrder(session.organizationId, session.branchId, id);
  if (!order) {
    notFound();
  }
  if (order.status !== "DRAFT") {
    redirect(`/orders/${id}`);
  }
  const { t } = await getI18n("orders");
  const levels = await listPriceLevels(session.organizationId);
  const blank = (value: string) => (value === "0.00" ? "" : value);
  const initial: OrderFormValues = {
    id,
    customer: { id: order.customer.id, name: order.customer.name, phone: order.customer.phone, outstanding: "", advance: "", customerTypeId: null },
    businessDate: order.businessDate,
    channel: order.channel,
    deliveryMethod: order.deliveryMethod,
    shippingAddress: order.shippingAddress ?? "",
    externalRef: order.externalRef ?? "",
    expectedDate: order.expectedDate ?? "",
    validUntil: order.validUntil ?? "",
    note: order.note ?? "",
    headerDiscount: blank(order.headerDiscount),
    chargesTotal: blank(order.chargesTotal),
    level: "",
    lines: order.items.map((item) => ({ productId: item.productId, label: `${item.sku} · ${item.name}`, price: item.unitPrice, available: null, quantity: item.quantity, discount: blank(item.discountAmount) })),
  };
  const name = order.number ?? order.quotationNumber ?? t("orders.draftOrder");

  return (
    <I18nBoundary areas={["orders"]}>
      <div className="space-y-6">
        <PageHeader
          title={t("orders.changeTitle", { number: name })}
          description={t("orders.changeDescription")}
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Orders", href: "/orders" }, { label: order.number ?? order.quotationNumber ?? t("orders.draft"), href: `/orders/${id}` }, { label: "Change" }]}
        />
        <OrderForm today={businessDate()} quotation={order.isQuotation} initial={initial} levels={levels.filter((level) => level.status === "ACTIVE").map((level) => level.name)} canChooseLevel={session.permissions.has("sales.price_level")} />
      </div>
    </I18nBoundary>
  );
}
