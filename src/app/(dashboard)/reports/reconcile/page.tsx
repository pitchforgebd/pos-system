import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { reconciliation } from "@/modules/reports/reconcile";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Reconciliation");

// Every check of the books on one page (P11 task 6): the books check, the identity lines of every report for the day, and the stored daily snapshots
// against the ledger. Company-wide, so it needs the all-branches and profit report permissions.
export default async function ReconcilePage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.permissions.has("reports.all_branches") || !session.permissions.has("reports.profit")) {
    redirect("/reports");
  }
  const bn = (await cookies()).get("meridian_lang")?.value === "bn";
  const result = await reconciliation(session.organizationId);
  const mark = (ok: boolean) => (ok ? "✔" : "✘");
  const tone = (ok: boolean) => (ok ? "bg-success-subtle text-success" : "bg-error-subtle text-error");

  return (
    <div className="space-y-6">
      <PageHeader
        title={bn ? "রিকনসিলিয়েশন" : ph("Reconciliation")}
        description={`${result.date} · ${result.ok ? (bn ? "সব মিলছে ✔" : "everything agrees ✔") : bn ? `${result.red}টি মিলছে না ✘` : `${result.red} check(s) do not agree ✘`}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Reconciliation") }]}
      />
      <section className="space-y-2" aria-label={ph("Books")}>
        <h2 className="text-lg font-semibold">{bn ? "বইয়ের পরীক্ষা" : ph("The books")}</h2>
        <p className={`rounded-md px-2 py-1 text-sm ${tone(result.books.findings.length === 0)}`}>
          {mark(result.books.findings.length === 0)} {bn ? "জার্নাল, পার্টি, স্টক, লট, বরাদ্দ, ট্রায়াল ব্যালান্স, ব্যালান্স শিট, সম্পদ" : ph("journals, parties, stock, lots, allocations, trial balance, balance sheet, fixed assets")}
        </p>
        {result.books.findings.map((finding) => (
          <p key={`${finding.invariant}|${finding.subject}`} className="rounded-md bg-error-subtle px-2 py-1 text-sm text-error">
            ✘ {finding.invariant} {finding.subject}: {finding.message}
          </p>
        ))}
        {result.books.warnings.map((warning) => (
          <p key={`${warning.invariant}|${warning.subject}`} className="rounded-md bg-warning-subtle px-2 py-1 text-sm text-warning">
            ! {warning.invariant} {warning.subject}: {warning.message}
          </p>
        ))}
      </section>
      <section className="space-y-2" aria-label={ph("Reports")}>
        <h2 className="text-lg font-semibold">{bn ? "রিপোর্টের মিল" : ph("The reports")}</h2>
        {result.reports.map((row) => (
          <div key={row.key} className="space-y-1">
            <Link href={`/reports/view?r=${row.key}&from=${result.date}&to=${result.date}`} className="text-sm font-semibold">
              {row.title[bn ? "bn" : "en"]}
            </Link>
            <ul className="space-y-1 text-sm">
              {row.checks.map((check) => (
                <li key={check.label.en} className={`rounded-md px-2 py-1 ${tone(check.ok)}`}>
                  {mark(check.ok)} {check.label[bn ? "bn" : "en"]} — {check.left} / {check.right}
                  {check.ok ? "" : ` (${bn ? "পার্থক্য" : "difference"} ${check.difference})`}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <section className="space-y-2" aria-label={ph("Snapshots")}>
        <h2 className="text-lg font-semibold">{bn ? "দিনের স্ন্যাপশট" : ph("Daily snapshots")}</h2>
        <p className={`rounded-md px-2 py-1 text-sm ${tone(result.snapshots.differences.length === 0)}`}>
          {mark(result.snapshots.differences.length === 0)} {bn ? `${result.snapshots.checked}টি স্ন্যাপশট লেজারের সাথে মিলিয়ে দেখা হয়েছে` : `${result.snapshots.checked} stored snapshot(s) compared with the ledger`}
        </p>
        {result.snapshots.differences.map((row) => (
          <p key={`${row.branch}|${row.date}|${row.field}`} className="rounded-md bg-error-subtle px-2 py-1 text-sm text-error">
            ✘ {row.date} · {row.branch} · {row.field}: {bn ? "জমা আছে" : ph("stored")} {row.stored}, {bn ? "লেজারে এখন" : ph("the ledger now")} {row.now}
          </p>
        ))}
      </section>
    </div>
  );
}
