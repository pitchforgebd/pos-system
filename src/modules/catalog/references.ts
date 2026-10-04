import { prisma } from "@/lib/db/client";

type Named = { organizationId: string; name: string };

async function taken(kind: "brand" | "category" | "unit", input: Named) {
  const name = input.name.trim();
  const where = { organizationId: input.organizationId, name };
  if (kind === "brand") {
    return prisma.brand.findFirst({ where, select: { id: true } });
  }
  if (kind === "category") {
    return prisma.category.findFirst({ where, select: { id: true } });
  }
  return prisma.unit.findFirst({ where, select: { id: true } });
}

export function listBrands(organizationId: string) {
  return prisma.brand.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, _count: { select: { products: true } } },
  });
}

export async function createBrand(input: Named) {
  if (await taken("brand", input)) {
    return { ok: false as const, status: 409 as const, message: "That name already exists." };
  }
  const row = await prisma.brand.create({
    data: { organizationId: input.organizationId, name: input.name.trim() },
    select: { id: true, name: true, status: true },
  });
  return { ok: true as const, row };
}

export function listCategories(organizationId: string) {
  return prisma.category.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, _count: { select: { products: true } } },
  });
}

export async function createCategory(input: Named) {
  if (await taken("category", input)) {
    return { ok: false as const, status: 409 as const, message: "That name already exists." };
  }
  const row = await prisma.category.create({
    data: { organizationId: input.organizationId, name: input.name.trim() },
    select: { id: true, name: true, status: true },
  });
  return { ok: true as const, row };
}

export function listUnits(organizationId: string) {
  return prisma.unit.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, _count: { select: { products: true } } },
  });
}

export async function createUnit(input: Named) {
  if (await taken("unit", input)) {
    return { ok: false as const, status: 409 as const, message: "That name already exists." };
  }
  const row = await prisma.unit.create({
    data: { organizationId: input.organizationId, name: input.name.trim() },
    select: { id: true, name: true, status: true },
  });
  return { ok: true as const, row };
}
