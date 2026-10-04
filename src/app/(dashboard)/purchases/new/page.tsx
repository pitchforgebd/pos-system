import { redirect } from "next/navigation";

import { PurchaseForm } from "@/components/purchasing/purchase-form";
import { PageHeader } from "@/components/ui/page-header";
import { listProducts } from "@/modules/catalog/products";
import { getSession } from "@/modules/auth/current-session";
import { listSuppliers } from "@/modules/purchasing/suppliers";

export const metadata = { title: "New purchase" };

export default async function NewPurchasePage() {
  const session = await getSession();
  if (!session || !session.permissions.has("purchase.create")) {
    redirect("/purchases");
  }
  const [suppliers, products] = await Promise.all([
    listSuppliers(session.organizationId),
    listProducts(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New purchase"
        description="The server calculates the line total. Discount, VAT, and charges are not applied."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases", href: "/purchases" }, { label: "New" }]}
      />
      <PurchaseForm
        suppliers={suppliers.filter((supplier) => supplier.status === "ACTIVE").map((supplier) => ({ id: supplier.id, label: supplier.name }))}
        products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))}
      />
    </div>
  );
}
