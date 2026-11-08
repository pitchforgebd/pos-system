import { redirect } from "next/navigation";

import { SalesList } from "@/components/sales/sales-list";
import { PageHeader } from "@/components/ui/page-header";
import { listQuery } from "@/core/list";
import { getSession } from "@/modules/auth/current-session";
import { listSales, saleSorts } from "@/modules/sales/sales";

export const metadata = { title: "Sold invoices" };

type SearchParams = Promise<{ page?: string; pageSize?: string; sort?: string }>;

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const { rows, page } = await listSales(session.organizationId, session.branchId, listQuery(params, { sorts: saleSorts }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sold invoices"
        description="Invoice numbers allocated when the sale is posted."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales", href: "/sales" }, { label: "Invoices" }]}
      />
      <SalesList rows={rows} page={page} path="/sales/invoices" params={{ sort: params.sort }} />
    </div>
  );
}
