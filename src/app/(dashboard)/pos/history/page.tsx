import { redirect } from "next/navigation";

import { SalesList } from "@/components/sales/sales-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { listQuery } from "@/core/list";
import { getSession } from "@/modules/auth/current-session";
import { listSales, saleSorts } from "@/modules/sales/sales";

export const metadata = { title: "POS history" };

type SearchParams = Promise<{ page?: string; pageSize?: string; sort?: string }>;

export default async function PosHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const { rows, page } = await listSales(session.organizationId, session.branchId, listQuery(params, { sorts: saleSorts }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="POS history"
        description="Posted register sales for this branch."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Register", href: "/pos" }, { label: "History" }]}
        actions={
          <Button href="/pos" variant="secondary">
            New sale
          </Button>
        }
      />
      <SalesList rows={rows} page={page} path="/pos/history" params={{ sort: params.sort }} />
    </div>
  );
}
