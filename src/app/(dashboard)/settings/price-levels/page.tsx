import { redirect } from "next/navigation";

import { AddLevelForm, LevelRow, TypeLevelSelect } from "@/components/settings/price-levels";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db/client";
import { getSession } from "@/modules/auth/current-session";
import { listPriceLevels } from "@/modules/pricing/admin";

export const metadata = { title: "Price levels" };

export default async function PriceLevelsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [levels, types] = await Promise.all([
    listPriceLevels(session.organizationId),
    prisma.customerType.findMany({ where: { organizationId: session.organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, priceLevelId: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Price levels"
        description="Retail, Wholesale and Dealer, and any you add. A product has a price for each level, and for each quantity step (Wholesale 10+ bags, 50+ bags). The default level answers when a level has no price. A customer type buys at its level."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Settings", href: "/settings" }, { label: "Price levels" }]}
      />
      <AddLevelForm />
      <ul className="space-y-2">
        {levels.map((level) => (
          <LevelRow key={level.id} level={level} />
        ))}
      </ul>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Customer types</h2>
        <p className="text-sm text-muted">The level a customer of each type buys at when the sale does not name one.</p>
        {types.length === 0 ? <p className="text-sm text-muted">No customer types yet.</p> : types.map((type) => <TypeLevelSelect key={type.id} type={type} levels={levels} />)}
      </section>
    </div>
  );
}
