import { redirect } from "next/navigation";

import { SalesTable } from "@/components/sales/sales-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listSales } from "@/modules/sales/sales";

export const metadata = { title: "Sold invoices" };

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const sales = await listSales(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sold invoices"
        description="Invoice numbers allocated when the sale is posted."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales", href: "/sales" }, { label: "Invoices" }]}
      />
      <SalesTable rows={sales} />
    </div>
  );
}
