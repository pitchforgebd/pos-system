import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { listAuditLogs } from "@/modules/auth/audit";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Audit logs" };

export default async function AuditLogsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const rows = await listAuditLogs(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit logs"
        description="Recent actions in this organization. Passwords and tokens are not stored here."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Audit logs" }]}
      />
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-secondary text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Module</th>
              <th className="px-3 py-2 font-medium">User</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-3 py-2">{row.createdAt.toISOString()}</td>
                <td className="px-3 py-2">{row.action}</td>
                <td className="px-3 py-2">{row.module}</td>
                <td className="px-3 py-2">{row.user?.email ?? "Unknown"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
