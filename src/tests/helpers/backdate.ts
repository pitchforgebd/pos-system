import type { PrismaClient } from "@prisma/client";

/**
 * Gives a test user a role holding posting.backdate. For the older tests that post to fixed past dates with a user of their own: since
 * the 16-day user test the posting engine keeps the back-date window (D18) for every user, so those users need the permission an owner has.
 * Takes the test's own client (the older tests import it after loading their environment).
 */
export async function grantBackdate(prisma: PrismaClient, user: { id: string; organizationId: string }) {
  const permission = await prisma.permission.upsert({
    where: { code: "posting.backdate" },
    update: {},
    create: { code: "posting.backdate", module: "posting" },
  });
  const role = await prisma.role.create({ data: { organizationId: user.organizationId, name: `Back-dated postings ${user.id.slice(0, 8)}` } });
  await prisma.rolePermission.create({ data: { organizationId: user.organizationId, roleId: role.id, permissionId: permission.id } });
  await prisma.userRole.create({ data: { organizationId: user.organizationId, userId: user.id, roleId: role.id } });
}
