import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { expiryWarnings, lowStockCount } from "@/modules/inventory/alerts";
import { listTakeOffs } from "@/modules/inventory/documents";
import { stockSummary } from "@/modules/inventory/stock";

export const metadata = { title: "Inventory" };

const ACTIONS: Array<[string, string, string]> = [
  ["/inventory/stock", "Stock", "What is on hand, by product and warehouse"],
  ["/inventory/summary", "Stock summary", "Quantity and value by product"],
  ["/inventory/ledger", "Product ledger", "Every movement of stock"],
  ["/inventory/alerts", "Stock alerts", "Low stock, reorder list, expiry warnings"],
  ["/inventory/opening-stock", "Opening stock", "Stock the shop started with"],
  ["/inventory/own-stock", "Own stock", "Goods the owner brings in"],
  ["/inventory/adjustments", "Adjustments", "Correct a count"],
  ["/inventory/damage", "Damage", "Goods that cannot be sold"],
  ["/inventory/expiry", "Expiry", "Lots and write-offs"],
  ["/inventory/take-off", "Take-off", "Goods out without a sale"],
  ["/inventory/transfers", "Transfers", "Move stock between warehouses and branches"],
];

export default async function InventoryHubPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [summary, low, expiry, takeOffs] = await Promise.all([
    stockSummary(session.organizationId, session.branchId),
    lowStockCount(session.organizationId, session.branchId),
    expiryWarnings(session.organizationId, session.branchId),
    listTakeOffs(session.organizationId, session.branchId, 5),
  ]);
  const near = expiry.buckets.slice(1).reduce((total, bucket) => total + bucket.lots, 0);
  const cards: Array<[string, string, string]> = [
    ["Stock value (avg cost)", summary.stockValue, "/inventory/summary"],
    ["Low or out of stock", String(low), "/inventory/alerts"],
    ["Lots expiring within 90 days", String(near), "/inventory/alerts"],
    ["Already expired", String(expiry.buckets[0]?.lots ?? 0), "/inventory/expiry"],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Stock is the books: every stock document posts its journal, valued at the average cost."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Inventory" }]}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, href]) => (
          <Link key={label} href={href} className="rounded-xl bg-[#2457c5] p-4 text-white">
            <span className="text-xs font-semibold tracking-wide">{label}</span>
            <span className="mt-3 block text-2xl font-semibold">{value}</span>
          </Link>
        ))}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ACTIONS.map(([href, title, text]) => (
          <li key={href}>
            <Link href={href} className="block rounded-xl border border-border bg-surface p-4">
              <span className="font-semibold">{title}</span>
              <span className="mt-1 block text-sm text-muted">{text}</span>
            </Link>
          </li>
        ))}
      </ul>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Latest take-offs</h2>
        {takeOffs.length === 0 ? (
          <p className="text-sm text-muted">No take-offs yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {takeOffs.map((row) => (
              <li key={row.id}>
                <Link href={`/inventory/take-off/${row.id}`}>
                  {row.number} · {row.businessDate} · {row.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")} · {row.value}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
