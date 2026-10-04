import { redirect } from "next/navigation";

import { BranchForm } from "@/components/access/branch-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { listCompanyBranches } from "@/modules/access/branches";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Branches" };

export default async function BranchesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const branches = await listCompanyBranches(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches"
        description="One company, many branches. Super Admin creates a branch. The header switches the branch you are using."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Branches" }]}
      />
      {session.permissions.has("branches.manage") ? <BranchForm /> : null}
      <DataTable
        caption="Branches"
        columns={[
          { key: "name", header: "Branch", cell: (row) => row.name },
          { key: "phone", header: "Phone", cell: (row) => row.phone },
          { key: "address", header: "Address", cell: (row) => row.address },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={branches}
        getRowKey={(row) => row.id}
      />
    </div>
  );
}
