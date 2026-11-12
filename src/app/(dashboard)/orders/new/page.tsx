import { redirect } from "next/navigation";

import { OrderForm } from "@/components/orders/order-form";
import { PageHeader } from "@/components/ui/page-header";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { listPriceLevels } from "@/modules/pricing/admin";

export const metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ quotation?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const quotation = params.quotation === "1";
  if (!session?.branchId || !session.permissions.has(quotation ? "quotations.manage" : "orders.create")) {
    redirect("/orders");
  }
  const levels = await listPriceLevels(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={quotation ? "New quotation" : "New order"}
        description={quotation ? "A quotation is a draft order with a valid-until date. When the customer says yes, confirm it and the stock is held." : "Choose the customer and the products: the price comes from the customer's price level and the quantity."}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: quotation ? "Quotations" : "Orders", href: quotation ? "/quotations" : "/orders" }, { label: "New" }]}
      />
      <OrderForm today={businessDate()} quotation={quotation} levels={levels.filter((level) => level.status === "ACTIVE").map((level) => level.name)} canChooseLevel={session.permissions.has("sales.price_level")} />
    </div>
  );
}
