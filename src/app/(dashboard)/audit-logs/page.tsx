import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { deviceLabel } from "@/lib/format/device";
import { AUDIT_PAGE_SIZE, searchAuditLogs } from "@/modules/auth/audit";
import { getSession } from "@/modules/auth/current-session";
import { isIsoDate } from "@/core/time/business-date";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Audit logs");

type Params = { page?: string; action?: string; module?: string; user?: string; from?: string; to?: string };

const dhakaTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

const clean = (value: string | undefined, max = 64) => (value ?? "").trim().slice(0, max) || undefined;
const day = (value: string | undefined) => (value && isIsoDate(value) ? value : undefined);

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const filters = { action: clean(params.action), module: clean(params.module), user: clean(params.user, 191), from: day(params.from), to: day(params.to) };
  const result = await searchAuditLogs(session.organizationId, { page: Number(params.page) || 1, ...filters });
  const link = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        search.set(key, value);
      }
    }
    search.set("page", String(page));
    return `/audit-logs?${search.toString()}`;
  };
  const first = result.total === 0 ? 0 : (result.page - 1) * AUDIT_PAGE_SIZE + 1;
  const last = Math.min(result.page * AUDIT_PAGE_SIZE, result.total);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Audit logs")}
        description={ph("Actions in this organization, newest first. Times are Dhaka time. Passwords and tokens are not stored here.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Audit logs") }]}
      />
      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">
          {ph("Action")}
          <input name="action" defaultValue={filters.action} className="h-10 rounded-md border border-border px-3" placeholder={ph("e.g. login")} />
        </label>
        <label className="grid gap-1">
          {ph("Module")}
          <input name="module" defaultValue={filters.module} className="h-10 rounded-md border border-border px-3" placeholder={ph("e.g. auth")} />
        </label>
        <label className="grid gap-1">
          {ph("User email")}
          <input name="user" defaultValue={filters.user} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1">
          {ph("From")}
          <input name="from" type="date" defaultValue={filters.from} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1">
          {ph("To")}
          <input name="to" type="date" defaultValue={filters.to} className="h-10 rounded-md border border-border px-3" />
        </label>
        <button type="submit" className="h-10 rounded-md border border-border bg-secondary px-4 font-medium">
          {ph("Filter")}
        </button>
        <Link href="/audit-logs" className="h-10 content-center text-primary">
          {ph("Clear")}
        </Link>
      </form>
      <p className="text-sm text-muted" aria-live="polite">
        {result.total === 0 ? ph("No entries.") : `${ph("Showing")} ${first}-${last} ${ph("of")} ${result.total}`}
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-secondary text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{ph("Time (Dhaka)")}</th>
              <th className="px-3 py-2 font-medium">{ph("User")}</th>
              <th className="px-3 py-2 font-medium">{ph("Action")}</th>
              <th className="px-3 py-2 font-medium">{ph("Module")}</th>
              <th className="px-3 py-2 font-medium">{ph("Record")}</th>
              <th className="px-3 py-2 font-medium">{ph("IP")}</th>
              <th className="px-3 py-2 font-medium">{ph("Device")}</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2">{dhakaTime.format(row.createdAt)}</td>
                <td className="px-3 py-2">{row.user?.email ?? ph("Unknown")}</td>
                <td className="px-3 py-2">{row.action}</td>
                <td className="px-3 py-2">{row.module}</td>
                <td className="px-3 py-2">{row.entityType}</td>
                <td className="px-3 py-2">{row.ip ?? ""}</td>
                <td className="px-3 py-2" title={row.userAgent ?? undefined}>
                  {deviceLabel(row.userAgent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.pages > 1 ? (
        <nav className="flex items-center gap-4 text-sm" aria-label={ph("Pages")}>
          {result.page > 1 ? (
            <Link href={link(result.page - 1)} className="text-primary">
              {ph("Newer")}
            </Link>
          ) : null}
          <span>
            {ph("Page")} {result.page} {ph("of")} {result.pages}
          </span>
          {result.page < result.pages ? (
            <Link href={link(result.page + 1)} className="text-primary">
              {ph("Older")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
