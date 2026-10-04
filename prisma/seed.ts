import { prisma } from "../src/lib/db/client.ts";
import { hashPassword } from "../src/modules/auth/password.ts";
import { permissionCodes } from "../src/lib/permissions/codes.ts";
import { accountGroups, accounts } from "./chart-of-accounts.ts";
import { seedDemoContent } from "./demo.ts";

async function main() {
  for (const code of permissionCodes) {
    const moduleName = code.split(".")[0] ?? code;
    await prisma.permission.upsert({
      where: { code },
      update: { module: moduleName },
      create: { code, module: moduleName },
    });
  }

  const organization = await prisma.organization.upsert({
    where: { slug: "meridian" },
    update: { name: "Meridian" },
    create: { name: "Meridian", slug: "meridian" },
  });

  for (const group of accountGroups) {
    await prisma.accountGroup.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: group.code } },
      update: { name: group.name },
      create: { organizationId: organization.id, code: group.code, name: group.name },
    });
  }

  const groups = await prisma.accountGroup.findMany({ where: { organizationId: organization.id } });
  const groupIdByCode = new Map(groups.map((group) => [group.code, group.id]));

  for (const account of accounts) {
    const groupId = groupIdByCode.get(account.groupCode);
    if (!groupId) {
      throw new Error(`Missing account group ${account.groupCode}`);
    }
    await prisma.account.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: account.code } },
      update: { name: account.name, groupId },
      create: { organizationId: organization.id, groupId, code: account.code, name: account.name },
    });
  }

  const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (ownerEmail && ownerPassword && ownerPassword.length >= 8) {
    const existingBranch = await prisma.branch.findFirst({ where: { organizationId: organization.id, name: "Main" } });
    const branch = existingBranch ?? (await prisma.branch.create({ data: { organizationId: organization.id, name: "Main" } }));
    const existingWarehouse = await prisma.warehouse.findFirst({
      where: { organizationId: organization.id, branchId: branch.id, name: "Main" },
    });
    if (!existingWarehouse) {
      await prisma.warehouse.create({ data: { organizationId: organization.id, branchId: branch.id, name: "Main" } });
    }
    const previousOwner = await prisma.role.findFirst({
      where: { organizationId: organization.id, name: "Owner" },
      select: { id: true },
    });
    const superAdminTaken = await prisma.role.findFirst({
      where: { organizationId: organization.id, name: "Super Admin" },
      select: { id: true },
    });
    if (previousOwner && !superAdminTaken) {
      await prisma.role.update({
        where: { id: previousOwner.id },
        data: { name: "Super Admin", note: "Creates branches and holds every permission." },
      });
    }
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: "Super Admin" } },
      update: { note: "Creates branches and holds every permission." },
      create: {
        organizationId: organization.id,
        name: "Super Admin",
        note: "Creates branches and holds every permission.",
      },
    });
    const adminRole = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: "Admin" } },
      update: { note: "Uses the company and manages roles. Does not create branches." },
      create: {
        organizationId: organization.id,
        name: "Admin",
        note: "Uses the company and manages roles. Does not create branches.",
      },
    });
    const permissions = await prisma.permission.findMany({ select: { id: true, code: true } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        organizationId: organization.id,
        roleId: role.id,
        permissionId: permission.id,
      })),
    });
    const adminPermissions = permissions.filter((permission) => permission.code !== "branches.manage");
    const adminAlreadyGranted = await prisma.rolePermission.count({ where: { roleId: adminRole.id } });
    if (adminAlreadyGranted === 0) {
      await prisma.rolePermission.createMany({
        data: adminPermissions.map((permission) => ({
          organizationId: organization.id,
          roleId: adminRole.id,
          permissionId: permission.id,
        })),
      });
    }
    const existingUser = await prisma.user.findUnique({
      where: { organizationId_email: { organizationId: organization.id, email: ownerEmail } },
      select: { id: true },
    });
    const user =
      existingUser ??
      (await prisma.user.create({
        data: {
          organizationId: organization.id,
          name: "Super Admin",
          email: ownerEmail,
          passwordHash: await hashPassword(ownerPassword),
        },
      }));
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { organizationId: organization.id, userId: user.id, roleId: role.id },
    });
    await prisma.userBranchAccess.upsert({
      where: { userId_branchId: { userId: user.id, branchId: branch.id } },
      update: {},
      create: { organizationId: organization.id, userId: user.id, branchId: branch.id },
    });
  }

  await seedDemoContent();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
