import { prisma } from "@/lib/db/client";
import { permissionCodes, type PermissionCode } from "@/lib/permissions/codes";
import { writeAudit } from "@/modules/auth/audit";

const allowed = new Set<string>(permissionCodes);

export async function listPermissionCatalog() {
  return prisma.permission.findMany({
    orderBy: { code: "asc" },
    select: { code: true, module: true, description: true },
  });
}

export async function listRoles(organizationId: string) {
  const roles = await prisma.role.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      note: true,
      permissions: { select: { permission: { select: { code: true } } } },
    },
  });
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    note: role.note,
    permissions: role.permissions.map((row) => row.permission.code),
  }));
}

export async function createRole(input: {
  organizationId: string;
  actorId: string;
  name: string;
  note?: string;
  ip: string;
  userAgent: string | null;
}) {
  const name = input.name.trim();
  const existing = await prisma.role.findUnique({
    where: { organizationId_name: { organizationId: input.organizationId, name } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false as const, status: 409 as const, message: "A role with that name already exists." };
  }
  const role = await prisma.role.create({
    data: { organizationId: input.organizationId, name, note: input.note?.trim() || null },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "role_change",
    module: "roles",
    entityType: "role",
    entityId: role.id,
    after: { name: role.name },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, role: { id: role.id, name: role.name, note: role.note, permissions: [] as string[] } };
}

export async function setRolePermissions(input: {
  organizationId: string;
  actorId: string;
  roleId: string;
  codes: string[];
  actorCanManageBranches: boolean;
  ip: string;
  userAgent: string | null;
}) {
  const unique = [...new Set(input.codes)];
  if (unique.some((code) => !allowed.has(code))) {
    return { ok: false as const, status: 400 as const, message: "Unknown permission code." };
  }
  const role = await prisma.role.findFirst({
    where: { id: input.roleId, organizationId: input.organizationId },
    select: { id: true, permissions: { select: { permission: { select: { code: true } } } } },
  });
  if (!role) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  const already = role.permissions.some((row) => row.permission.code === "branches.manage");
  const wants = unique.includes("branches.manage");
  if (!input.actorCanManageBranches && (already || wants)) {
    return { ok: false as const, status: 403 as const, message: "Only Super Admin can change that role." };
  }
  const permissions = await prisma.permission.findMany({
    where: { code: { in: unique } },
    select: { id: true, code: true },
  });
  if (permissions.length !== unique.length) {
    return { ok: false as const, status: 400 as const, message: "Unknown permission code." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          organizationId: input.organizationId,
          roleId: role.id,
          permissionId: permission.id,
        })),
      });
    }
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "permission_change",
    module: "roles",
    entityType: "role",
    entityId: role.id,
    after: { permissions: unique },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, permissions: unique as PermissionCode[] };
}
