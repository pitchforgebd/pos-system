import { redirect } from "next/navigation";

import { PurchaseForm } from "@/components/purchasing/purchase-form";
import { PageHeader } from "@/components/ui/page-header";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { moneyAccountOptions, warehouseOptions } from "@/modules/purchasing/lookups";
import { listSuppliers } from "@/modules/purchasing/suppliers";

export const metadata = { title: "New purchase" };

export default async function NewPurchasePage() {
  const session = await getSession();
  if (!session?.branchId || !session.permissions.has("purchase.create")) {
    redirect("/purchases");
  }
  const [suppliers, warehouses, accounts] = await Promise.all([
    listSuppliers(session.organizationId),
    warehouseOptions(session.organizationId, session.branchId),
    moneyAccountOptions(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New purchase"
        description="Add the lines, the discount and VAT, and what the haulage cost. The server works out each line's landed cost; save it as a draft, order it, or receive it now."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases", href: "/purchases" }, { label: "New" }]}
      />
      <PurchaseForm
        today={businessDate()}
        suppliers={suppliers.filter((supplier) => supplier.status === "ACTIVE").map((supplier) => ({ id: supplier.id, label: supplier.name }))}
        warehouses={warehouses.map((warehouse) => ({ id: warehouse.id, label: warehouse.name }))}
        accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, kind: account.kind }))}
      />
    </div>
  );
}
