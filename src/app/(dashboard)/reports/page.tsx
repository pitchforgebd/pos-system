import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { branchName, reportOverview } from "@/modules/reports/reports";

export const metadata = { title: "Reports" };

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
        title="Reports"
        description={`Posted figures for ${branch}. The client does not choose the branch. Export is not available on this screen.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports" }]}
      />
      <ul className="grid gap-2 sm:grid-cols-2">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link className="text-sm underline" href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <DataTable
        caption="Loyalty and SMS"
        columns={[
          { key: "name", header: "Report", cell: (row) => row.name },
          { key: "value", header: "Count", cell: (row) => row.value },
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
        Wallet report <span className="mt-1 block text-lg font-semibold">0.00</span>
        <span className="mt-1 block text-muted">The wallet ledger is not defined, so this balance stays at zero.</span>
      </p>
      <p className="text-sm text-muted">Point amounts are not defined, so loyalty points are not summed. SMS counts are for the organization and are not cash.</p>
    </div>
  );
}
