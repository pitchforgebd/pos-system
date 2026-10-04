import { redirect } from "next/navigation";

import { AccountForm } from "@/components/accounting/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts, listGroups } from "@/modules/accounting/books";

export const metadata = { title: "Chart of accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().toLowerCase() ?? "";
  const [accounts, groups] = await Promise.all([
    listAccounts(session.organizationId),
    listGroups(session.organizationId),
  ]);
  const rows = accounts.filter((row) => !q || `${row.code} ${row.name} ${row.groupName}`.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chart of accounts"
        description="Accounts used by posted journals. An inactive account cannot be used on a new entry."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Accounts" }]}
      />
      {session.permissions.has("accounting.create") ? <AccountForm groups={groups} /> : null}
      <form className="flex flex-wrap items-end gap-2" action="/accounting/accounts">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Code, name, or group" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Accounts"
        columns={[
          { key: "code", header: "Code", cell: (row) => row.code },
          { key: "name", header: "Account", cell: (row) => row.name },
          { key: "group", header: "Group", cell: (row) => row.groupName },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
      />
    </div>
  );
}
