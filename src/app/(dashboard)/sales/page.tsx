import { redirect } from "next/navigation";

import { SalesList } from "@/components/sales/sales-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { listQuery } from "@/core/list";
import { titled } from "@/lib/i18n/metadata";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { listSales, saleSorts } from "@/modules/sales/sales";

export const generateMetadata = titled("sales", "sales.listTitle");

type SearchParams = Promise<{ page?: string; pageSize?: string; sort?: string }>;

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { t } = await getI18n("sales");
  const params = await searchParams;
  const { rows, page } = await listSales(session.organizationId, session.branchId, listQuery(params, { sorts: saleSorts }));

  return (
    <I18nBoundary areas={["sales"]}>
      <div className="space-y-6">
        <PageHeader
          title={t("sales.listTitle")}
          description={t("sales.listDescription")}
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales" }]}
          actions={session.permissions.has("sales.create") ? <Button href="/sales/new">{t("sales.newSale")}</Button> : null}
        />
        <SalesList rows={rows} page={page} path="/sales" params={{ sort: params.sort }} />
      </div>
    </I18nBoundary>
  );
}
