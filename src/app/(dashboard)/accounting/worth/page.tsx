import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { companyWorth } from "@/modules/assets/worth";

export const metadata = { title: "Company Worth" };

export default async function WorthPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const worth = await companyWorth(session.organizationId);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Company worth"
        description="What the whole company owns and owes today, every branch together, each figure straight from the books. Open a line to see what is behind it."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Company worth" }]}
      />
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Totals">
        <Figure label="Owns" value={worth.assets} />
        <Figure label="Owes" value={worth.liabilities} />
        <Figure label="Net worth" value={worth.net} strong />
      </section>
      <div className="grid gap-8 lg:grid-cols-2">
        <Lines title="What the company owns" lines={worth.owns} total={worth.assets} />
        <Lines title="What the company owes" lines={worth.owes} total={worth.liabilities} />
      </div>
      <p className="text-xs text-muted">Net worth is what the owner&apos;s capital and the profits kept add up to. The balance sheet with every account comes with the reports.</p>
    </div>
  );
}

function Lines({ title, lines, total }: { title: string; lines: Array<{ key: string; label: string; amount: string; href: string }>; total: string }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="border-b border-border">
              <td className="py-2">
                <Link href={line.href}>{line.label}</Link>
              </td>
              <td className="py-2 text-right tabular-nums">{line.amount}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-semibold">Total</td>
            <td className="py-2 text-right font-semibold tabular-nums">{total}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`rounded-xl border border-border px-4 py-3 text-sm ${strong ? "bg-[#0f8f78] text-white" : "bg-surface"}`}>
      {label}
      <span className="mt-1 block text-2xl font-semibold">{value}</span>
    </p>
  );
}
