import { redirect } from "next/navigation";

import { CustomerForm } from "@/components/customers/forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listCustomerTypes } from "@/modules/customers/customers";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const session = await getSession();
  if (!session || !session.permissions.has("customers.create")) {
    redirect("/customers");
  }
  const types = await listCustomerTypes(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New customer"
        description="An opening balance greater than zero is written once as a ledger debit. It is not a journal."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "New" }]}
      />
      <CustomerForm types={types.filter((type) => type.status === "ACTIVE").map((type) => ({ id: type.id, label: type.name }))} />
    </div>
  );
}
