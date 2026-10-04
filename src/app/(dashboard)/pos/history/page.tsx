import { redirect } from "next/navigation";

import { SalesTable } from "@/components/sales/sales-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listSales } from "@/modules/sales/sales";

export const metadata = { title: "POS history" };

export default async function PosHistoryPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const sales = await listSales(session.organizationId, session.branchId);

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
      <SalesTable rows={sales} />
    </div>
  );
}
