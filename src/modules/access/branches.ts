import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

export async function listCompanyBranches(organizationId: string) {
  const rows = await prisma.branch.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, address: true, status: true },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone ?? "",
    address: row.address ?? "",
    status: row.status,
  }));
}

export async function createBranch(input: {
  organizationId: string;
  actorId: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  ip: string;
  userAgent: string | null;
}) {
  const name = input.name.trim();
  if (!name || name.length > 191) {
    return { ok: false as const, status: 422 as const, message: "Enter a branch name of up to 191 characters." };
  }
  const phone = input.phone?.trim() || null;
  if (phone && phone.length > 32) {
    return { ok: false as const, status: 422 as const, message: "Enter a phone of up to 32 characters." };
  }
  const address = input.address?.trim() || null;
  if (address && address.length > 255) {
    return { ok: false as const, status: 422 as const, message: "Enter an address of up to 255 characters." };
  }
  const duplicate = await prisma.branch.findFirst({
    where: { organizationId: input.organizationId, name },
    select: { id: true },
  });
  if (duplicate) {
    return { ok: false as const, status: 409 as const, message: "A branch with that name already exists." };
  }
  const branch = await prisma.$transaction(async (tx) => {
    const created = await tx.branch.create({
      data: { organizationId: input.organizationId, name, phone, address },
      select: { id: true, name: true },
    });
    await tx.warehouse.create({
      data: { organizationId: input.organizationId, branchId: created.id, name },
    });
    await tx.userBranchAccess.create({
      data: { organizationId: input.organizationId, userId: input.actorId, branchId: created.id },
    });
    return created;
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "create",
    module: "branches",
    entityType: "branch",
    entityId: branch.id,
    after: { name: branch.name },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, branch };
}
