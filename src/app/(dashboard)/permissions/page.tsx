import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { listPermissionCatalog } from "@/modules/access/roles";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Permissions" };

export default async function PermissionsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const permissions = await listPermissionCatalog();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permissions"
        description="These codes are fixed. This screen does not add new ones."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Permissions" }]}
      />
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-secondary text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Module</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((permission) => (
              <tr key={permission.code} className="border-t border-border">
                <td className="px-3 py-2">{permission.code}</td>
                <td className="px-3 py-2">{permission.module}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
