import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PrintButton } from "@/components/print/sheet";
import { ReportView } from "@/components/reports/report-view";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { DAILY, reportContext } from "@/modules/reports/registry";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Day Reports");

// "Generate all reports" (P11 task 7, U11): the day's ten reports one after the other, each on its own printed page, in the owner's order.
export default async function DayReportsPage({ searchParams }: { searchParams: Promise<{ date?: string; branch?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const lang = (await cookies()).get("meridian_lang")?.value === "bn" ? "bn" : "en";
  const params = await searchParams;
  const ctx = reportContext(session, { from: params.date, to: params.date, branch: params.branch });
  const reports = DAILY.filter((report) => !report.needs || session.permissions.has(report.needs));
  const results = "error" in ctx ? [] : await Promise.all(reports.map((report) => report.run(ctx)));
  const red = results.reduce((sum, result) => sum + result.identities.filter((check) => !check.ok).length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={lang === "bn" ? "দিনের সব রিপোর্ট" : ph("All reports of the day")}
        description={"error" in ctx ? ctx.error : `${ctx.from} · ${results.length} ${lang === "bn" ? "টি রিপোর্ট" : "reports"}${red > 0 ? (lang === "bn" ? ` · ${red}টি মিল হয়নি` : ` · ${red} check(s) do not agree`) : lang === "bn" ? " · সব মিল ✔" : " · every check agrees ✔"}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: lang === "bn" ? "দিনের সব রিপোর্ট" : ph("Day reports") }]}
        actions={<PrintButton label={lang === "bn" ? "সব প্রিন্ট" : ph("Print all")} />}
      />
      <form className="flex flex-wrap items-end gap-2 print:hidden" action="/reports/day">
        <label className="grid gap-1 text-sm">
          {lang === "bn" ? "তারিখ" : ph("Day")}
          <input name="date" type="date" defaultValue={"error" in ctx ? "" : ctx.from} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          {lang === "bn" ? "ব্রাঞ্চ" : ph("Branch")}
          <select name="branch" defaultValue={params.branch ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">{lang === "bn" ? "এই ব্রাঞ্চ" : ph("This branch")}</option>
            {session.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
            {session.permissions.has("reports.all_branches") ? <option value="all">{lang === "bn" ? "সব ব্রাঞ্চ" : ph("All branches")}</option> : null}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          {lang === "bn" ? "দেখাও" : ph("Show")}
        </Button>
      </form>
      {results.map((result, index) => (
        <section key={result.key} className={index > 0 ? "break-before-page space-y-3 pt-4" : "space-y-3"} aria-label={result.title[lang]}>
          <h2 className="text-xl font-semibold">
            {index + 1}. {result.title[lang]}
          </h2>
          <ReportView result={result} lang={lang} />
        </section>
      ))}
    </div>
  );
}
