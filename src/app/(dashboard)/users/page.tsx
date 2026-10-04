import { redirect } from "next/navigation";

import { UserAdmin } from "@/components/access/user-admin";
import { PageHeader } from "@/components/ui/page-header";
import { listRoles } from "@/modules/access/roles";
import { listBranches, listUsers } from "@/modules/access/users";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const canManageBranches = session.permissions.has("branches.manage");
  const [users, roles, branches] = await Promise.all([
    listUsers(session.organizationId),
    session.permissions.has("roles.manage") ? listRoles(session.organizationId) : Promise.resolve([]),
    listBranches(session.organizationId),
  ]);
  const protectedRoleIds = new Set(roles.filter((role) => role.permissions.includes("branches.manage")).map((role) => role.id));
  const assignableRoles = canManageBranches ? roles : roles.filter((role) => !protectedRoleIds.has(role.id));
  const protectedUserIds = canManageBranches
    ? []
    : users.filter((user) => user.roles.some((role) => protectedRoleIds.has(role.id))).map((user) => user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Accounts in this organization. Passwords are stored only as hashes."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Users" }]}
      />
      <UserAdmin
        users={users}
        roles={assignableRoles.map((role) => ({ id: role.id, name: role.name }))}
        branches={branches}
        canCreate={session.permissions.has("users.create")}
        canDisable={session.permissions.has("users.disable")}
        canAssignRoles={session.permissions.has("roles.manage")}
        protectedUserIds={protectedUserIds}
      />
    </div>
  );
}
