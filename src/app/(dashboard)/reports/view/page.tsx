import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PrintButton } from "@/components/print/sheet";
import { ReportView } from "@/components/reports/report-view";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { allReports, findReport, reportContext } from "@/modules/reports/registry";

export const metadata = { title: "Report" };

type Params = { r?: string; from?: string; to?: string; branch?: string };

export default async function ReportPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const lang = (await cookies()).get("meridian_lang")?.value === "bn" ? "bn" : "en";
  const params = await searchParams;
  const report = findReport(params.r ?? "cash") ?? findReport("cash");
  if (!report) {
    redirect("/reports");
  }
  const allowed = !report.needs || session.permissions.has(report.needs);
  const ctx = reportContext(session, params);
  const result = allowed && !("error" in ctx) ? await report.run(ctx) : null;
  const query = (format: string) => {
    const search = new URLSearchParams({ format, lang });
    if (!("error" in ctx)) {
      search.set("from", ctx.from);
      search.set("to", ctx.to);
    }
    if (params.branch) {
      search.set("branch", params.branch);
    }
    return `/api/v1/reports/run/${report.key}?${search.toString()}`;
  };
  const bad = result ? result.identities.filter((check) => !check.ok).length : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={report.title[lang]}
        description={result ? `${result.from === result.to ? result.from : `${result.from} – ${result.to}`}${bad > 0 ? (lang === "bn" ? ` · ${bad}টি মিল হয়নি` : ` · ${bad} check(s) do not agree`) : ""}` : ""}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: report.title[lang] }]}
        actions={
          result ? (
            <>
              <PrintButton label={lang === "bn" ? "প্রিন্ট" : "Print"} />
              {session.permissions.has("reports.export") ? (
                <>
                  <a className="text-sm font-medium text-primary" href={query("csv")}>
                    CSV
                  </a>
                  <a className="text-sm font-medium text-primary" href={query("xlsx")}>
                    Excel
                  </a>
                </>
              ) : null}
            </>
          ) : null
        }
      />
      <form className="flex flex-wrap items-end gap-2 print:hidden" action="/reports/view">
        <label className="grid gap-1 text-sm">
          {lang === "bn" ? "রিপোর্ট" : "Report"}
          <select name="r" defaultValue={report.key} className="h-10 rounded-md border border-border bg-surface px-2">
            {allReports()
              .filter((row) => !row.needs || session.permissions.has(row.needs))
              .map((row) => (
                <option key={row.key} value={row.key}>
                  {row.title[lang]}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {lang === "bn" ? "থেকে" : "From"}
          <input name="from" type="date" defaultValue={"error" in ctx ? "" : ctx.from} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          {lang === "bn" ? "পর্যন্ত" : "To"}
          <input name="to" type="date" defaultValue={"error" in ctx ? "" : ctx.to} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          {lang === "bn" ? "ব্রাঞ্চ" : "Branch"}
          <select name="branch" defaultValue={params.branch ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">{lang === "bn" ? "এই ব্রাঞ্চ" : "This branch"}</option>
            {session.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
            {session.permissions.has("reports.all_branches") ? <option value="all">{lang === "bn" ? "সব ব্রাঞ্চ" : "All branches"}</option> : null}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          {lang === "bn" ? "দেখাও" : "Show"}
        </Button>
        <Link href="/reports/day" className="text-sm text-muted">
          {lang === "bn" ? "সারাদিনের সব রিপোর্ট" : "All reports of a day"}
        </Link>
      </form>
      {!allowed ? <p className="text-sm text-error">{lang === "bn" ? "এই রিপোর্টের জন্য লাভের রিপোর্টের পারমিশন লাগে।" : "This report needs the profit report permission."}</p> : null}
      {"error" in ctx ? <p className="text-sm text-error">{ctx.error}</p> : null}
      {result ? <ReportView result={result} lang={lang} /> : null}
    </div>
  );
}
