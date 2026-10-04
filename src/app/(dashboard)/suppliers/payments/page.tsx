import { redirect } from "next/navigation";

import { PartyAmountForm } from "@/components/customers/party-search";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listSuppliers } from "@/modules/purchasing/suppliers";

export const metadata = { title: "Supplier payment" };

export default async function SupplierPaymentsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const suppliers = session.permissions.has("suppliers.payment") ? await listSuppliers(session.organizationId) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier payment"
        description="Search by name or phone. Cash posts to account 1100 and bank posts to account 1200. The payment cannot exceed the outstanding payable."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: "Payment" }]}
      />
      {session.permissions.has("suppliers.payment") ? (
        <PartyAmountForm
          title="Take payment"
          url={(id) => `/api/v1/suppliers/${id}/payments`}
          mode="due"
          balanceLabel="Payable"
          parties={suppliers
            .filter((supplier) => supplier.status === "ACTIVE")
            .map((supplier) => ({ id: supplier.id, name: supplier.name, phone: supplier.phone, outstanding: supplier.outstanding }))}
        />
      ) : null}
    </div>
  );
}
