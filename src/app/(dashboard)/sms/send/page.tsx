import { redirect } from "next/navigation";

import { SendForm } from "@/components/sms/forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listRegisterCustomers } from "@/modules/customers/customers";
import { listSuppliers } from "@/modules/purchasing/suppliers";
import { listTemplates, smsDashboard } from "@/modules/sms/sms";

export const metadata = { title: "Send SMS" };

export default async function SendSmsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [templates, customers, suppliers, figures] = await Promise.all([
    listTemplates(session.organizationId),
    listRegisterCustomers(session.organizationId),
    listSuppliers(session.organizationId),
    smsDashboard(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Send SMS"
        description="The provider is called after the message row is saved. A failure stays on that row. The balance is not cash."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: "Send" }]}
      />
      <SendForm
        templates={templates.filter((template) => template.status === "ACTIVE").map((template) => ({ id: template.id, label: template.name }))}
        customers={customers}
        suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, phone: supplier.phone }))}
        balance={figures.balance}
      />
    </div>
  );
}
