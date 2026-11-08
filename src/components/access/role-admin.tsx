"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

export function RoleAdmin({
  roles,
  permissions,
  lockedRoleIds = [],
}: {
  roles: { id: string; name: string; permissions: string[] }[];
  permissions: string[];
  lockedRoleIds?: string[];
}) {
  const { submit, pending, message: error } = useSubmit();

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error" title={error} /> : null}
      <form
        className="flex max-w-md items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void submit({ url: "/api/v1/roles", body: { name: String(form.get("name") ?? "") } }, { successMessage: "Role created." });
        }}
      >
        <FormField label="Role name" htmlFor="role-name" required>
          <Input id="role-name" name="name" required />
        </FormField>
        <Button type="submit" loading={pending}>Create role</Button>
      </form>
      {roles.map((role) => lockedRoleIds.includes(role.id) ? (
        <section key={role.id} className="space-y-2 rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">{role.name}</h2>
          <p className="text-sm text-muted">Only Super Admin can change this role.</p>
        </section>
      ) : (
        <form
          key={role.id}
          className="space-y-3 rounded-md border border-border bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const selected = new FormData(event.currentTarget).getAll("permissions").map(String);
            void submit({ url: `/api/v1/roles/${role.id}`, method: "PATCH", body: { permissions: selected } }, { successMessage: `${role.name} permissions saved.` });
          }}
        >
          <h2 className="text-sm font-semibold">{role.name}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {permissions.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="permissions" value={code} defaultChecked={role.permissions.includes(code)} />
                {code}
              </label>
            ))}
          </div>
          <Button type="submit" size="sm" loading={pending}>
            Save permissions
          </Button>
        </form>
      ))}
    </div>
  );
}
