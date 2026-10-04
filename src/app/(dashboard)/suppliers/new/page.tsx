import { redirect } from "next/navigation";

import { SupplierForm } from "@/components/purchasing/supplier-form";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  const session = await getSession();
  if (!session || !session.permissions.has("suppliers.create")) {
    redirect("/suppliers");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New supplier"
        description="Opening payable is written once. It is not edited later."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: "New" }]}
      />
      <SupplierForm />
    </div>
  );
}
