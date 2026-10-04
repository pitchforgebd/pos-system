import { redirect } from "next/navigation";

import { TransferForm } from "@/components/inventory/transfer-form";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db/client";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Transfers" };

export default async function TransfersPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [branches, products] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        warehouses: { where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    }),
    prisma.product.findMany({
      where: { organizationId: session.organizationId, deletedAt: null, status: "ACTIVE" },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true, sku: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Transfer"
        description="Stock stays at the source until this receive. Receive posts the out and the in together. Nothing sits in transit."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Product Transfer" }]}
      />
      {session.permissions.has("inventory.transfer") ? <TransferForm branches={branches} products={products} /> : null}
    </div>
  );
}
