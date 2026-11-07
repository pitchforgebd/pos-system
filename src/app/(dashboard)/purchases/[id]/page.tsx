import { notFound, redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getPurchase } from "@/modules/purchasing/purchases";

export const metadata = { title: "Purchase" };

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const purchase = await getPurchase(session.organizationId, session.branchId, id);
  if (!purchase) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={purchase.number ?? "Purchase"}
        description={`${purchase.supplier.name} · ${purchase.businessDate} · ${purchase.total}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases", href: "/purchases" }, { label: purchase.number ?? "Purchase" }]}
      />
      <DataTable
        caption="Purchase lines"
        columns={[
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
          { key: "cost", header: "Unit cost", cell: (row) => row.unitCost },
          { key: "total", header: "Line total", cell: (row) => row.lineTotal },
        ]}
        rows={purchase.items}
        getRowKey={(row) => row.id}
      />
      <p className="text-sm text-muted">
        Discount {purchase.discountTotal}, VAT {purchase.vatTotal}, charges {purchase.chargesTotal}. Journal{" "}
        {purchase.journalBalanced ? "is balanced" : "is not balanced"}.
      </p>
    </div>
  );
}
