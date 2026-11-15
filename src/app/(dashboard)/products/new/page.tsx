import { redirect } from "next/navigation";

import { ProductForm } from "@/components/catalog/product-form";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("New product");

export default async function NewProductPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.permissions.has("products.create")) {
    redirect("/products");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("New product")}
        description={ph("Prices are stored as decimals. A JPEG, PNG, or WebP photo can be added with the product.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("New") }]}
      />
      <ProductForm />
    </div>
  );
}
