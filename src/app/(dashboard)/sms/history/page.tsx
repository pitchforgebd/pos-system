import { redirect } from "next/navigation";

import { RetryForm } from "@/components/sms/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listMessages, listNotificationLogs } from "@/modules/sms/sms";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("SMS Histories");

const messageStatuses = ["QUEUED", "SENDING", "SENT", "FAILED"] as const;

export default async function SmsHistoryPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const ph = await getPhrase();
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
        title={ph("SMS Histories")}
        description={ph("Each try is logged. A message is tried four times; a failed one can be put back in the outbox. A sent one is never sent again.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: ph("History") }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/sms/history">
        <label className="grid gap-1 text-sm">
          {ph("Status")}
          <select name="status" defaultValue={status} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">{ph("All")}</option>
            {messageStatuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          {ph("Search")}
          <input name="q" defaultValue={params.q ?? ""} placeholder={ph("Phone or message")} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          {ph("Search")}
        </Button>
      </form>
      <DataTable
        caption={ph("Messages")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.createdAt.slice(0, 10) },
          { key: "to", header: ph("To"), cell: (row) => row.recipient },
          { key: "message", header: ph("Message"), cell: (row) => row.body },
          { key: "parts", header: ph("SMS"), cell: (row) => row.parts },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
          { key: "tries", header: ph("Tries"), cell: (row) => row.attempts },
          { key: "note", header: ph("Note"), cell: (row) => (row.status === "SENT" ? "" : row.result) },
          { key: "retry", header: ph("Retry"), cell: (row) => (row.status === "FAILED" ? <RetryForm messageId={row.id} /> : null) },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No messages")} description={ph("Sent and failed messages appear here.")} />}
      />
      <DataTable
        caption={ph("Notification log")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.createdAt.slice(0, 10) },
          { key: "to", header: ph("To"), cell: (row) => row.recipient },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={logs}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No notification log")} description={ph("An SMS attempt writes a notification row.")} />}
      />
    </div>
  );
}
