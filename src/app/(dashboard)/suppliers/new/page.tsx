import { redirect } from "next/navigation";

import { VendorForm } from "@/components/parties/party-forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { geography } from "@/modules/parties/profile";

export const metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  const session = await getSession();
  if (!session || !session.permissions.has("suppliers.create")) {
    redirect("/suppliers");
  }
  const places = await geography();

  return (
    <div className="space-y-6">
      <PageHeader
        title="New supplier"
        description="The district is required. A code is made for the vendor. What the shop owed them before goes in once as an opening payable."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: "New" }]}
      />
      <VendorForm places={places} />
    </div>
  );
}
