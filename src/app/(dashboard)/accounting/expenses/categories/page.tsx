import { redirect } from "next/navigation";

import { CategoryForm } from "@/components/treasury/forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listCategories, listExpenseAccounts } from "@/modules/treasury/expenses";

export const metadata = { title: "Expense Categories" };

export default async function ExpenseCategoriesPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [categories, accounts] = await Promise.all([listCategories(session.organizationId), listExpenseAccounts(session.organizationId)]);
  const canEdit = session.permissions.has("settings.manage");
  const options = accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }));
  const typeLabel = { MONTHLY_FIXED: "Fixed monthly", VARIABLE: "Variable", MISC: "Miscellaneous" } as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expense categories"
        description="Each category posts to one expense account of the chart. A fixed monthly cost (rent, salary) can be set to come every month from the Expenses page."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Expenses", href: "/accounting/expenses" }, { label: "Categories" }]}
      />
      {canEdit ? (
        <section className="space-y-3" aria-label="Add a category">
          <h2 className="text-lg font-semibold">Add a category</h2>
          <CategoryForm accounts={options} />
        </section>
      ) : null}
      <section className="space-y-2" aria-label="Categories">
        {categories.map((category) =>
          canEdit ? (
            <CategoryForm key={category.id} accounts={options} initial={{ id: category.id, name: category.name, accountId: category.accountId, type: category.type, active: category.status === "ACTIVE" }} />
          ) : (
            <p key={category.id} className="rounded-md border border-border p-3 text-sm">
              {category.name} · {category.accountCode} {category.accountName} · {typeLabel[category.type]}
              {category.status === "ACTIVE" ? "" : " · inactive"}
            </p>
          ),
        )}
      </section>
    </div>
  );
}
