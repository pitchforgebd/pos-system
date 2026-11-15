import { redirect } from "next/navigation";

import { CustomerForm } from "@/components/parties/party-forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listCustomerTypes } from "@/modules/customers/customers";
import { geography } from "@/modules/parties/profile";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("New customer");

export default async function NewCustomerPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session || !session.permissions.has("customers.create")) {
    redirect("/customers");
  }
  const [types, places] = await Promise.all([listCustomerTypes(session.organizationId), geography()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("New customer")}
        description={ph("The district is required (for district reports and offers). A code is made for the customer. What they owed before goes in once as an opening balance.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: ph("New") }]}
      />
      <CustomerForm types={types.filter((type) => type.status === "ACTIVE").map((type) => ({ id: type.id, label: type.name }))} places={places} />
    </div>
  );
}
