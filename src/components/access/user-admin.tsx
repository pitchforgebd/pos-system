"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

type UserRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  roles: { id: string; name: string }[];
  branches: { id: string; name: string }[];
};

export function UserAdmin({
  users,
  roles,
  branches,
  canCreate,
  canDisable,
  canAssignRoles,
  protectedUserIds = [],
}: {
  users: UserRow[];
  roles: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  canCreate: boolean;
  canDisable: boolean;
  canAssignRoles: boolean;
  protectedUserIds?: string[];
}) {
  const { ph } = useI18n();
  const { submit, pending, message: error } = useSubmit();

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error" title={error} /> : null}
      {canCreate ? (
        <form
          className="grid max-w-xl gap-3 rounded-md border border-border bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const roleIds = canAssignRoles ? form.getAll("roleIds").map(String) : [];
            void submit(
              {
                url: "/api/v1/users",
                body: {
                  name: String(form.get("name") ?? ""),
                  email: String(form.get("email") ?? ""),
                  password: String(form.get("password") ?? ""),
                  roleIds,
                  branchIds: form.getAll("branchIds").map(String),
                },
              },
              { successMessage: ph("User created.") },
            );
          }}
        >
          <FormField label={ph("Name")} htmlFor="user-name" required>
            <Input id="user-name" name="name" required />
          </FormField>
          <FormField label={ph("Email")} htmlFor="user-email" required>
            <Input id="user-email" name="email" type="email" required />
          </FormField>
          <FormField label={ph("Password")} htmlFor="user-password" required>
            <Input id="user-password" name="password" type="password" minLength={8} required />
          </FormField>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{ph("Branches")}</legend>
            {branches.map((branch) => (
              <label key={branch.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="branchIds" value={branch.id} />
                {branch.name}
              </label>
            ))}
          </fieldset>
          {canAssignRoles ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{ph("Roles")}</legend>
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="roleIds" value={role.id} />
                  {role.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          <Button type="submit">{ph("Create user")}</Button>
        </form>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-secondary text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{ph("Name")}</th>
              <th className="px-3 py-2 font-medium">{ph("Email")}</th>
              <th className="px-3 py-2 font-medium">{ph("Status")}</th>
              <th className="px-3 py-2 font-medium">{ph("Roles")}</th>
              <th className="px-3 py-2 font-medium">{ph("Branches")}</th>
              <th className="px-3 py-2 font-medium">{ph("Action")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-border">
                <td className="px-3 py-2">{user.name}</td>
                <td className="px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">{user.status}</td>
                <td className="px-3 py-2">{user.roles.map((role) => role.name).join(", ") || ph("None")}</td>
                <td className="px-3 py-2">{user.branches.map((branch) => branch.name).join(", ") || ph("None")}</td>
                <td className="px-3 py-2">
                  {canDisable && user.status === "ACTIVE" && !protectedUserIds.includes(user.id) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={pending}
                      onClick={() => {
                        void submit({ url: `/api/v1/users/${user.id}`, method: "PATCH", body: { status: "DISABLED" } }, { successMessage: ph("User disabled.") });
                      }}
                    >
                      {ph("Disable")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
