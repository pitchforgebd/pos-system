import { redirect } from "next/navigation";

import { BranchForm } from "@/components/access/branch-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { listCompanyBranches } from "@/modules/access/branches";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Branches");

export default async function BranchesPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const branches = await listCompanyBranches(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Branches")}
        description={ph("One company, many branches. Super Admin creates a branch. The header switches the branch you are using.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Branches") }]}
      />
      {session.permissions.has("branches.manage") ? <BranchForm /> : null}
      <DataTable
        caption={ph("Branches")}
        columns={[
          { key: "name", header: ph("Branch"), cell: (row) => row.name },
          { key: "phone", header: ph("Phone"), cell: (row) => row.phone },
          { key: "address", header: ph("Address"), cell: (row) => row.address },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={branches}
        getRowKey={(row) => row.id}
      />
    </div>
  );
}
