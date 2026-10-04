import { redirect } from "next/navigation";

import { RetryForm } from "@/components/sms/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listMessages, listNotificationLogs } from "@/modules/sms/sms";

export const metadata = { title: "SMS Histories" };

const messageStatuses = ["PENDING", "SENT", "FAILED"] as const;

export default async function SmsHistoryPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().toLowerCase() ?? "";
  const status = messageStatuses.find((item) => item === params.status) ?? "";
  const [messages, logs] = await Promise.all([
    listMessages(session.organizationId),
    listNotificationLogs(session.organizationId),
  ]);
  const rows = messages.filter((row) => {
    if (status && row.status !== status) {
      return false;
    }
    if (!q) {
      return true;
    }
    return `${row.recipient} ${row.body}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="SMS Histories"
        description="Each attempt is logged. Retry is available only for a failed message."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: "History" }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/sms/history">
        <label className="grid gap-1 text-sm">
          Status
          <select name="status" defaultValue={status} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All</option>
            {messageStatuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Phone or message" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Messages"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.createdAt.slice(0, 10) },
          { key: "to", header: "To", cell: (row) => row.recipient },
          { key: "message", header: "Message", cell: (row) => row.body },
          { key: "status", header: "Status", cell: (row) => row.status },
          { key: "retry", header: "Retry", cell: (row) => (row.status === "FAILED" ? <RetryForm messageId={row.id} /> : null) },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No messages" description="Sent and failed messages appear here." />}
      />
      <DataTable
        caption="Notification log"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.createdAt.slice(0, 10) },
          { key: "to", header: "To", cell: (row) => row.recipient },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={logs}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No notification log" description="An SMS attempt writes a notification row." />}
      />
    </div>
  );
}
