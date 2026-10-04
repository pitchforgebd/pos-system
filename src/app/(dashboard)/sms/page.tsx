import Link from "next/link";
import { redirect } from "next/navigation";

import { SmsMetrics } from "@/components/sms/metrics";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listMessages, smsDashboard } from "@/modules/sms/sms";

export const metadata = { title: "SMS" };

export default async function SmsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [figures, messages] = await Promise.all([
    smsDashboard(session.organizationId),
    listMessages(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="SMS"
        description="A failed provider does not post a journal."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS" }]}
        actions={<Button href="/sms/send">Send SMS</Button>}
      />
      <SmsMetrics figures={figures} />
      <DataTable
        caption="Recent messages"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.createdAt.slice(0, 10) },
          { key: "to", header: "To", cell: (row) => row.recipient },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={messages.slice(0, 20)}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No messages" description="Send a message to record it, even when the provider is not configured." />}
      />
      <p className="text-sm">
        <Link href="/sms/history">History</Link>
      </p>
    </div>
  );
}
