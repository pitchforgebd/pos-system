import { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { runTx } from "@/core/tx/run";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { ensurePriceLevels } from "@/modules/pricing/levels";

// Price level settings (P04 task 4, D6): the owner adds levels beyond Retail, Wholesale and Dealer, renames them, chooses the default,
// and says which level each customer type buys at.

type Who = { organizationId: string; actorId: string; ip: string; userAgent: string | null };

export type PriceLevelRow = { id: string; name: string; isDefault: boolean; status: "ACTIVE" | "INACTIVE"; prices: number; customerTypes: number };

export async function listPriceLevels(organizationId: string): Promise<PriceLevelRow[]> {
  const { levels } = await ensurePriceLevels(prisma, organizationId);
  const [prices, types] = await Promise.all([
    prisma.productPrice.groupBy({ by: ["priceLevelId"], where: { organizationId }, _count: { _all: true } }),
    prisma.customerType.groupBy({ by: ["priceLevelId"], where: { organizationId, priceLevelId: { not: null } }, _count: { _all: true } }),
  ]);
  const priceCount = new Map(prices.map((row) => [row.priceLevelId, row._count._all]));
  const typeCount = new Map(types.map((row) => [row.priceLevelId, row._count._all]));
  return levels.map((level) => ({
    id: level.id,
    name: level.name,
    isDefault: level.isDefault,
    status: level.status,
    prices: priceCount.get(level.id) ?? 0,
    customerTypes: typeCount.get(level.id) ?? 0,
  }));
}

function cleanName(value: string) {
  const name = value.trim();
  if (name.length < 1 || name.length > 64) {
    throw new RuleError("A price level name is 1 to 64 characters.");
  }
  return name;
}

async function guarded<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() };
  } catch (error) {
    if (error instanceof RuleError) {
      return { ok: false as const, status: error.status, message: error.message };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, status: 409 as const, message: "A price level with that name already exists." };
    }
    throw error;
  }
}

export function createPriceLevel(input: Who & { name: string }) {
  return guarded(async () => {
    const name = cleanName(input.name);
    const { levels } = await ensurePriceLevels(prisma, input.organizationId);
    const level = await prisma.priceLevel.create({ data: { organizationId: input.organizationId, name, sortOrder: Math.max(0, ...levels.map((row) => row.sortOrder)) + 1 } });
    await writeAudit({ organizationId: input.organizationId, userId: input.actorId, action: "create", module: "products", entityType: "price_level", entityId: level.id, after: { name }, ip: input.ip, userAgent: input.userAgent });
    return level.id;
  });
}

/** Rename a level, switch it on or off, or make it the default (the level everything falls back to). The default cannot be switched off. */
export function updatePriceLevel(input: Who & { id: string; name?: string; status?: "ACTIVE" | "INACTIVE"; makeDefault?: boolean }) {
  return guarded(async () => {
    const level = await prisma.priceLevel.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
    if (!level) {
      throw new RuleError("That record was not found.", 404);
    }
    if (input.status === "INACTIVE" && (level.isDefault || input.makeDefault)) {
      throw new RuleError("The default price level cannot be switched off. Choose another default first.");
    }
    await runTx(async (tx) => {
      if (input.makeDefault && !level.isDefault) {
        await tx.priceLevel.updateMany({ where: { organizationId: input.organizationId, isDefault: true }, data: { isDefault: false } });
      }
      await tx.priceLevel.update({
        where: { id: level.id },
        data: {
          ...(input.name !== undefined ? { name: cleanName(input.name) } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.makeDefault ? { isDefault: true, status: "ACTIVE" as const } : {}),
        },
      });
    });
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.actorId,
      action: "update",
      module: "products",
      entityType: "price_level",
      entityId: level.id,
      before: { name: level.name, status: level.status, isDefault: level.isDefault },
      after: { name: input.name ?? level.name, status: input.status ?? level.status, isDefault: input.makeDefault ? true : level.isDefault },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return level.id;
  });
}

/** The level customers of a type buy at; null: the default level. */
export function setCustomerTypeLevel(input: Who & { customerTypeId: string; priceLevelId: string | null }) {
  return guarded(async () => {
    const type = await prisma.customerType.findFirst({ where: { id: input.customerTypeId, organizationId: input.organizationId }, select: { id: true, name: true, priceLevelId: true } });
    if (!type) {
      throw new RuleError("That record was not found.", 404);
    }
    if (input.priceLevelId) {
      const level = await prisma.priceLevel.findFirst({ where: { id: input.priceLevelId, organizationId: input.organizationId, status: "ACTIVE" }, select: { id: true } });
      if (!level) {
        throw new RuleError("Choose an active price level.");
      }
    }
    await prisma.customerType.update({ where: { id: type.id }, data: { priceLevelId: input.priceLevelId } });
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.actorId,
      action: "update",
      module: "customers",
      entityType: "customer_type",
      entityId: type.id,
      before: { priceLevelId: type.priceLevelId },
      after: { priceLevelId: input.priceLevelId },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return type.id;
  });
}
