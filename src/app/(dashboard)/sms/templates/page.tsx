import { redirect } from "next/navigation";

import { TemplateForm } from "@/components/sms/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listTemplates } from "@/modules/sms/sms";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("SMS templates");

export default async function SmsTemplatesPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const templates = await listTemplates(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("SMS templates")}
        description={ph("Bill and due-collection text. Variables are substituted. They are not executed.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: ph("Templates") }]}
      />
      <TemplateForm />
      <DataTable
        caption={ph("Templates")}
        columns={[
          { key: "name", header: ph("Name"), cell: (row) => row.name },
          { key: "kind", header: ph("Kind"), cell: (row) => row.kind },
          { key: "body", header: ph("Message"), cell: (row) => row.body },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={templates}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No templates")} description={ph("Save a bill or due-collection message.")} />}
      />
    </div>
  );
}
