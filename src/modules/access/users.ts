import { prisma } from "@/lib/db/client";
import { runTx } from "@/core/tx/run";
import { writeAudit } from "@/modules/auth/audit";
import { hashPassword } from "@/modules/auth/password";
import { revokeUserSessions } from "@/modules/auth/session";

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  roles: { select: { role: { select: { id: true, name: true } } } },
  branchAccess: { select: { branch: { select: { id: true, name: true } } } },
} as const;

function present(user: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "DISABLED";
  roles: { role: { id: string; name: string } }[];
  branchAccess: { branch: { id: string; name: string } }[];
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    roles: user.roles.map((row) => row.role),
    branches: user.branchAccess.map((row) => row.branch),
  };
}

export async function listBranches(organizationId: string) {
  return prisma.branch.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function listUsers(organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: userSelect,
  });
  return users.map(present);
}

export async function getUser(organizationId: string, id: string) {
  const user = await prisma.user.findFirst({ where: { id, organizationId }, select: userSelect });
  return user ? present(user) : null;
}

async function branchesInOrg(organizationId: string, branchIds: string[]) {
  if (branchIds.length === 0) {
    return [];
  }
  const rows = await prisma.branch.findMany({
    where: { organizationId, id: { in: branchIds } },
    select: { id: true },
  });
  return rows.length === branchIds.length ? rows : null;
}

async function grantsBranchManagement(organizationId: string, roleIds: string[]) {
  if (roleIds.length === 0) {
    return false;
  }
  const hit = await prisma.rolePermission.findFirst({
    where: { organizationId, roleId: { in: roleIds }, permission: { code: "branches.manage" } },
    select: { roleId: true },
  });
  return Boolean(hit);
}

async function userHoldsBranchManagement(organizationId: string, userId: string) {
  const hit = await prisma.userRole.findFirst({
    where: {
      organizationId,
      userId,
      role: { permissions: { some: { permission: { code: "branches.manage" } } } },
    },
    select: { userId: true },
  });
  return Boolean(hit);
}

function branchAdminRefusal(actorCanManageBranches: boolean) {
  if (actorCanManageBranches) {
    return null;
  }
  return { ok: false as const, status: 403 as const, message: "Only Super Admin can change that account." };
}

async function rolesInOrg(organizationId: string, roleIds: string[]) {
  if (roleIds.length === 0) {
    return [];
  }
  const rows = await prisma.role.findMany({
    where: { organizationId, id: { in: roleIds } },
    select: { id: true },
  });
  return rows.length === roleIds.length ? rows : null;
}

export async function createUser(input: {
  organizationId: string;
  actorId: string;
  name: string;
  email: string;
  password: string;
  roleIds: string[];
  branchIds: string[];
  actorCanManageBranches: boolean;
  ip: string;
  userAgent: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId: input.organizationId, email } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false as const, status: 409 as const, message: "A user with that email already exists." };
  }
  if (!input.actorCanManageBranches && (await grantsBranchManagement(input.organizationId, input.roleIds))) {
    return { ok: false as const, status: 403 as const, message: "Only Super Admin can assign that role." };
  }
  const branches = await branchesInOrg(input.organizationId, input.branchIds);
  const roles = await rolesInOrg(input.organizationId, input.roleIds);
  if (!branches || !roles) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      organizationId: input.organizationId,
      name: input.name.trim(),
      email,
      passwordHash,
      roles: { create: input.roleIds.map((roleId) => ({ organizationId: input.organizationId, roleId })) },
      branchAccess: { create: input.branchIds.map((branchId) => ({ organizationId: input.organizationId, branchId })) },
    },
    select: userSelect,
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "create",
    module: "users",
    entityType: "user",
    entityId: user.id,
    after: { name: user.name, email: user.email, status: user.status },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, user: present(user) };
}

export async function updateUser(input: {
  organizationId: string;
  actorId: string;
  userId: string;
  name?: string;
  phone?: string | null;
  branchIds?: string[];
  actorCanManageBranches: boolean;
  ip: string;
  userAgent: string | null;
}) {
  const current = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId },
    select: { id: true, name: true, phone: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  if (input.branchIds && (await userHoldsBranchManagement(input.organizationId, current.id))) {
    const refused = branchAdminRefusal(input.actorCanManageBranches);
    if (refused) {
      return refused;
    }
  }
  if (input.branchIds) {
    const branches = await branchesInOrg(input.organizationId, input.branchIds);
    if (!branches) {
      return { ok: false as const, status: 404 as const, message: "That record was not found." };
    }
  }
  await runTx(async (tx) => {
    await tx.user.update({
      where: { id: current.id },
      data: {
        name: input.name?.trim(),
        phone: input.phone,
      },
    });
    if (input.branchIds) {
      await tx.userBranchAccess.deleteMany({ where: { userId: current.id } });
      if (input.branchIds.length > 0) {
        await tx.userBranchAccess.createMany({
          data: input.branchIds.map((branchId) => ({
            organizationId: input.organizationId,
            userId: current.id,
            branchId,
          })),
        });
      }
      await tx.session.updateMany({
        where: { userId: current.id, branchId: { not: null }, NOT: { branchId: { in: input.branchIds } } },
        data: { branchId: null },
      });
    }
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "update",
    module: "users",
    entityType: "user",
    entityId: current.id,
    before: { name: current.name, phone: current.phone },
    after: { name: input.name ?? current.name, phone: input.phone === undefined ? current.phone : input.phone },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, user: await getUser(input.organizationId, current.id) };
}

export async function disableUser(input: {
  organizationId: string;
  actorId: string;
  userId: string;
  actorCanManageBranches: boolean;
  ip: string;
  userAgent: string | null;
}) {
  const current = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId },
    select: { id: true, status: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  if (await userHoldsBranchManagement(input.organizationId, current.id)) {
    const refused = branchAdminRefusal(input.actorCanManageBranches);
    if (refused) {
      return refused;
    }
  }
  await prisma.user.update({ where: { id: current.id }, data: { status: "DISABLED" } });
  await revokeUserSessions(current.id);
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "update",
    module: "users",
    entityType: "user",
    entityId: current.id,
    before: { status: current.status },
    after: { status: "DISABLED" },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const };
}

export async function replaceUserRoles(input: {
  organizationId: string;
  actorId: string;
  userId: string;
  roleIds: string[];
  actorCanManageBranches: boolean;
  ip: string;
  userAgent: string | null;
}) {
  const current = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  const holds = await userHoldsBranchManagement(input.organizationId, current.id);
  const assigns = await grantsBranchManagement(input.organizationId, input.roleIds);
  if (!input.actorCanManageBranches && (holds || assigns)) {
    return { ok: false as const, status: 403 as const, message: "Only Super Admin can change that account." };
  }
  const roles = await rolesInOrg(input.organizationId, input.roleIds);
  if (!roles) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  await runTx(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: current.id } });
    if (input.roleIds.length > 0) {
      await tx.userRole.createMany({
        data: input.roleIds.map((roleId) => ({ organizationId: input.organizationId, userId: current.id, roleId })),
      });
    }
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "role_change",
    module: "users",
    entityType: "user",
    entityId: current.id,
    after: { roleIds: input.roleIds },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const };
}
