import { redirect } from "next/navigation";

import { NamedRecordForm } from "@/components/catalog/named-record-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listCategories } from "@/modules/catalog/references";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Categories");

export default async function CategoriesPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const categories = await listCategories(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Categories")}
        description={ph("The generic filter uses category. There is no separate generic field.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("Categories") }]}
      />
      {session.permissions.has("products.create") ? <NamedRecordForm action="/api/v1/categories" label={ph("Category name")} /> : null}
      <DataTable
        caption={ph("Categories")}
        columns={[
          { key: "name", header: ph("Category"), cell: (row) => row.name },
          { key: "products", header: ph("Products"), cell: (row) => row._count.products },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={categories}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No categories")} description={ph("Add a category to group products.")} />}
      />
    </div>
  );
}
