import { redirect } from "next/navigation";

import { RoleAdmin } from "@/components/access/role-admin";
import { PageHeader } from "@/components/ui/page-header";
import { listPermissionCatalog, listRoles } from "@/modules/access/roles";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Roles");

export default async function RolesPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [roles, permissions] = await Promise.all([listRoles(session.organizationId), listPermissionCatalog()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Roles")}
        description={ph("Admin manages roles. Branch creation stays with Super Admin.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Roles") }]}
      />
      <RoleAdmin
        roles={roles}
        lockedRoleIds={
          session.permissions.has("branches.manage")
            ? []
            : roles.filter((role) => role.permissions.includes("branches.manage")).map((role) => role.id)
        }
        permissions={permissions
          .map((item) => item.code)
          .filter((code) => session.permissions.has("branches.manage") || code !== "branches.manage")}
      />
    </div>
  );
}
