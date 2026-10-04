import { redirect } from "next/navigation";

import { SalesTable } from "@/components/sales/sales-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listSales } from "@/modules/sales/sales";

export const metadata = { title: "Sales" };

export default async function SalesPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const sales = await listSales(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description="Each posted sale decreases stock and writes the invoice and journal together."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales" }]}
        actions={session.permissions.has("sales.create") ? <Button href="/sales/new">New sale</Button> : null}
      />
      <SalesTable rows={sales} />
    </div>
  );
}
