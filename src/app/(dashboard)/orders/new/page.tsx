import { redirect } from "next/navigation";

import { OrderForm } from "@/components/orders/order-form";
import { PageHeader } from "@/components/ui/page-header";
import { businessDate } from "@/core/time/business-date";
import { titled } from "@/lib/i18n/metadata";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { listPriceLevels } from "@/modules/pricing/admin";

export const generateMetadata = titled("orders", "orders.newTitle");

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ quotation?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const quotation = params.quotation === "1";
  if (!session?.branchId || !session.permissions.has(quotation ? "quotations.manage" : "orders.create")) {
    redirect("/orders");
  }
  const { t } = await getI18n("orders");
  const levels = await listPriceLevels(session.organizationId);

  return (
    <I18nBoundary areas={["orders"]}>
      <div className="space-y-6">
        <PageHeader
          title={quotation ? t("orders.quotationTitle") : t("orders.newTitle")}
          description={quotation ? t("orders.quotationDescription") : t("orders.newDescription")}
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: quotation ? "Quotations" : "Orders", href: quotation ? "/quotations" : "/orders" }, { label: "New" }]}
        />
        <OrderForm today={businessDate()} quotation={quotation} levels={levels.filter((level) => level.status === "ACTIVE").map((level) => level.name)} canChooseLevel={session.permissions.has("sales.price_level")} />
      </div>
    </I18nBoundary>
  );
}
