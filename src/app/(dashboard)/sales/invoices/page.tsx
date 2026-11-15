import { redirect } from "next/navigation";

import { SalesList } from "@/components/sales/sales-list";
import { PageHeader } from "@/components/ui/page-header";
import { listQuery } from "@/core/list";
import { titled } from "@/lib/i18n/metadata";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { listSales, saleSorts } from "@/modules/sales/sales";

export const generateMetadata = titled("sales", "sales.invoicesTitle");

type SearchParams = Promise<{ page?: string; pageSize?: string; sort?: string }>;

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
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
          title={t("sales.invoicesTitle")}
          description={t("sales.invoicesDescription")}
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales", href: "/sales" }, { label: "Invoices" }]}
        />
        <SalesList rows={rows} page={page} path="/sales/invoices" params={{ sort: params.sort }} />
      </div>
    </I18nBoundary>
  );
}
