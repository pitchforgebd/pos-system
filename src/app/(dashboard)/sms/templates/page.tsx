import { redirect } from "next/navigation";

import { TemplateForm } from "@/components/sms/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listTemplates } from "@/modules/sms/sms";

export const metadata = { title: "SMS templates" };

export default async function SmsTemplatesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const templates = await listTemplates(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="SMS templates"
        description="Bill and due-collection text. Variables are substituted. They are not executed."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: "Templates" }]}
      />
      <TemplateForm />
      <DataTable
        caption="Templates"
        columns={[
          { key: "name", header: "Name", cell: (row) => row.name },
          { key: "kind", header: "Kind", cell: (row) => row.kind },
          { key: "body", header: "Message", cell: (row) => row.body },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={templates}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No templates" description="Save a bill or due-collection message." />}
      />
    </div>
  );
}
