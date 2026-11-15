import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { branchName, reportOverview } from "@/modules/reports/reports";
import { DAILY, OTHER } from "@/modules/reports/registry";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Reports");

const links = [
  ["Sales", "/reports/sales"],
  ["Sales report by product", "/reports/sales/products"],
  ["Payment-method report", "/reports/payments"],
  ["Due sale report", "/reports/due-sales"],
  ["Customer due collection", "/customers/payments"],
  ["Customer return list", "/sales/returns"],
  ["Purchases", "/reports/purchases"],
  ["Inventory", "/reports/inventory"],
  ["Customers", "/reports/customers"],
  ["Supplier table ledger", "/reports/suppliers"],
  ["Supplier payment vouchers", "/suppliers/payments"],
  ["Accounts expense ledger", "/accounting/expenses"],
  ["Cash", "/reports/cash"],
  ["Bank", "/reports/bank"],
  ["Profit and loss", "/reports/profit-loss"],
  ["Trial balance", "/reports/trial-balance"],
  ["Day book", "/reports/day-book"],
  ["Account statement", "/accounting/statements"],
];

export default async function ReportsPage() {
  const ph = await getPhrase();
  const lang = (await cookies()).get("meridian_lang")?.value === "bn" ? "bn" : "en";
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [branch, overview] = await Promise.all([
    branchName(session.organizationId, session.branchId),
    reportOverview(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Reports")}
        description={lang === "bn" ? `${branch}-এর পোস্ট করা হিসাব, প্রতিটি বই থেকে নেওয়া, প্রতিটির সঙ্গে খতিয়ানের মিলের যাচাই। প্রতিটি রিপোর্টে প্রিন্ট, CSV ও Excel আছে।` : `Posted figures for ${branch}, every one from the books, each with its check against the ledger. Print, CSV and Excel are on every report.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Reports") }]}
        actions={<Link href="/reports/day" className="text-sm font-medium text-primary">{ph("All reports of a day")}</Link>}
      />
      <section className="space-y-2" aria-label={ph("Daily reports")}>
        <h2 className="text-lg font-semibold">{ph("Daily reports")}</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DAILY.filter((report) => !report.needs || session.permissions.has(report.needs)).map((report) => (
            <li key={report.key}>
              <Link className="text-sm underline" href={`/reports/view?r=${report.key}`}>
                {report.title[lang]}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2" aria-label={ph("Monthly and other reports")}>
        <h2 className="text-lg font-semibold">{ph("Monthly and other reports")}</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {OTHER.filter((report) => !report.needs || session.permissions.has(report.needs)).map((report) => (
            <li key={report.key}>
              <Link className="text-sm underline" href={`/reports/view?r=${report.key}`}>
                {report.title[lang]}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <h2 className="text-lg font-semibold">{ph("Other screens")}</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link className="text-sm underline" href={href}>
              {ph(label)}
            </Link>
          </li>
        ))}
      </ul>
      <DataTable
        caption={ph("Loyalty and SMS")}
        columns={[
          { key: "name", header: ph("Report"), cell: (row) => row.name },
          { key: "value", header: ph("Count"), cell: (row) => row.value },
        ]}
        rows={[
          { id: "cards", name: "Loyalty cards", value: String(overview.loyaltyCards) },
          { id: "points", name: "Loyalty point rows", value: String(overview.loyaltyPointRows) },
          { id: "sent", name: "SMS sent", value: String(overview.smsSent) },
          { id: "failed", name: "SMS failed", value: String(overview.smsFailed) },
        ]}
        getRowKey={(row) => row.id}
      />
      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
        {ph("Wallet report")} <span className="mt-1 block text-lg font-semibold">0.00</span>
        <span className="mt-1 block text-muted">{ph("The wallet ledger is not defined, so this balance stays at zero.")}</span>
      </p>
      <p className="text-sm text-muted">{ph("Point amounts are not defined, so loyalty points are not summed. SMS counts are for the organization and are not cash.")}</p>
    </div>
  );
}
