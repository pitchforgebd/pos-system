import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { companyWorth } from "@/modules/assets/worth";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Company Worth");

export default async function WorthPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const worth = await companyWorth(session.organizationId);

  return (
    <div className="space-y-8">
      <PageHeader
        title={ph("Company worth")}
        description={ph("What the whole company owns and owes today, every branch together, each figure straight from the books. Open a line to see what is behind it.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Company worth") }]}
      />
      <section className="grid gap-3 sm:grid-cols-3" aria-label={ph("Totals")}>
        <Figure label={ph("Owns")} value={worth.assets} />
        <Figure label={ph("Owes")} value={worth.liabilities} />
        <Figure label={ph("Net worth")} value={worth.net} strong />
      </section>
      <div className="grid gap-8 lg:grid-cols-2">
        <Lines title={ph("What the company owns")} lines={worth.owns} total={worth.assets} />
        <Lines title={ph("What the company owes")} lines={worth.owes} total={worth.liabilities} />
      </div>
      <p className="text-xs text-muted">{ph("Net worth is what the owner's capital and the profits kept add up to. The balance sheet with every account comes with the reports.")}</p>
    </div>
  );
}

async function Lines({ title, lines, total }: { title: string; lines: Array<{ key: string; label: string; amount: string; href: string }>; total: string }) {
  const ph = await getPhrase();
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="border-b border-border">
              <td className="py-2">
                <Link href={line.href}>{ph(line.label)}</Link>
              </td>
              <td className="py-2 text-right tabular-nums">{line.amount}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-semibold">{ph("Total")}</td>
            <td className="py-2 text-right font-semibold tabular-nums">{total}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`rounded-xl border border-border px-4 py-3 text-sm ${strong ? "bg-[#0b7a66] text-white" : "bg-surface"}`}>
      {label}
      <span className="mt-1 block text-2xl font-semibold">{value}</span>
    </p>
  );
}
