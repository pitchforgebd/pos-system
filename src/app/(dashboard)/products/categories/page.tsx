import { redirect } from "next/navigation";

import { NamedRecordForm } from "@/components/catalog/named-record-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listCategories } from "@/modules/catalog/references";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const categories = await listCategories(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="The generic filter uses category. There is no separate generic field."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Categories" }]}
      />
      {session.permissions.has("products.create") ? <NamedRecordForm action="/api/v1/categories" label="Category name" /> : null}
      <DataTable
        caption="Categories"
        columns={[
          { key: "name", header: "Category", cell: (row) => row.name },
          { key: "products", header: "Products", cell: (row) => row._count.products },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={categories}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No categories" description="Add a category to group products." />}
      />
    </div>
  );
}
