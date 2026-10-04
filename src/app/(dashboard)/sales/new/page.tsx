import { redirect } from "next/navigation";

import { CustomerForm, SaleForm } from "@/components/sales/sale-form";
import { getSession } from "@/modules/auth/current-session";
import { listRegisterProducts } from "@/modules/catalog/products";
import { listBrands, listCategories } from "@/modules/catalog/references";
import { listRegisterCustomers } from "@/modules/customers/customers";

export const metadata = { title: "New sale" };

export default async function NewSalePage() {
  const session = await getSession();
  if (!session?.branchId || !session.permissions.has("sales.create")) {
    redirect("/sales");
  }
  const [products, customers, brands, categories] = await Promise.all([
    listRegisterProducts(session.organizationId, session.branchId),
    listRegisterCustomers(session.organizationId),
    listBrands(session.organizationId),
    listCategories(session.organizationId),
  ]);
  const branchName = session.branches.find((branch) => branch.id === session.branchId)?.name ?? "Branch";

  return (
    <div className="space-y-4">
      <SaleForm
        products={products}
        customers={customers}
        brands={brands.filter((brand) => brand.status === "ACTIVE").map((brand) => ({ id: brand.id, name: brand.name }))}
        categories={categories.filter((category) => category.status === "ACTIVE").map((category) => ({ id: category.id, name: category.name }))}
        branchName={branchName}
        canDiscount={session.permissions.has("sales.discount")}
        canOverride={session.permissions.has("sales.price_override")}
      />
      {session.permissions.has("customers.create") ? <CustomerForm /> : null}
    </div>
  );
}
