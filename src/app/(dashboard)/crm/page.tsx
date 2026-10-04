import { redirect } from "next/navigation";

import { CrmForms } from "@/components/customers/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listAssignableUsers, listCrmActivities, listCrmContacts, listCrmSegments } from "@/modules/customers/crm";

export const metadata = { title: "CRM" };

export default async function CrmPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [contacts, segments, activities, users] = await Promise.all([
    listCrmContacts(session.organizationId),
    listCrmSegments(session.organizationId),
    listCrmActivities(session.organizationId),
    listAssignableUsers(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM"
        description="Contacts, segments, follow-ups, and assignments. Marketing status has no field, so it is not stored."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "CRM" }]}
      />
      {session.permissions.has("crm.manage") ? (
        <CrmForms
          contacts={contacts.map((contact) => ({ id: contact.id, label: contact.name }))}
          segments={segments.map((segment) => ({ id: segment.id, label: segment.name }))}
          users={users.map((user) => ({ id: user.id, label: user.name }))}
        />
      ) : null}
      <DataTable
        caption="Contacts"
        columns={[
          { key: "name", header: "Contact", cell: (row) => row.name },
          { key: "phone", header: "Phone", cell: (row) => row.phone ?? "" },
          { key: "segment", header: "Segment", cell: (row) => row.segmentName ?? "" },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={contacts}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No contacts" description="Add a contact to record a follow-up." />}
      />
      <DataTable
        caption="Follow-ups"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "contact", header: "Contact", cell: (row) => row.contactName },
          { key: "note", header: "Note", cell: (row) => row.note },
        ]}
        rows={activities}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No follow-ups" description="A follow-up is a dated note on a contact." />}
      />
    </div>
  );
}
