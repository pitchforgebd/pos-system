import { Prisma, type PriceLevel, type PrismaClient } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

/** The three levels every organization starts with (D6): Retail is the default; the owner adds more. */
export const STANDARD_LEVELS = [
  { name: "Retail", isDefault: true, sortOrder: 1 },
  { name: "Wholesale", isDefault: false, sortOrder: 2 },
  { name: "Dealer", isDefault: false, sortOrder: 3 },
] as const;

/**
 * Makes sure the organization has its standard price levels and one default, and returns its levels. One row at a time, so two
 * callers at the same moment cannot deadlock or fail on the unique name (the other's row is simply there).
 */
export async function ensurePriceLevels(db: Db, organizationId: string): Promise<{ levels: PriceLevel[]; byName: Map<string, PriceLevel>; defaultLevel: PriceLevel }> {
  let levels = await db.priceLevel.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const have = new Set(levels.map((level) => level.name));
  const missing = STANDARD_LEVELS.filter((level) => !have.has(level.name));
  for (const level of missing) {
    try {
      await db.priceLevel.create({ data: { organizationId, name: level.name, isDefault: level.isDefault && !levels.some((other) => other.isDefault), sortOrder: level.sortOrder } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
  }
  if (missing.length > 0) {
    levels = await db.priceLevel.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }
  let defaultLevel = levels.find((level) => level.isDefault);
  if (!defaultLevel) {
    const retail = levels.find((level) => level.name === "Retail") ?? levels[0];
    if (retail) {
      defaultLevel = await db.priceLevel.update({ where: { id: retail.id }, data: { isDefault: true } });
      levels = levels.map((level) => (level.id === defaultLevel?.id ? (defaultLevel as PriceLevel) : level));
    }
  }
  if (!defaultLevel) {
    throw new Error("The organization has no price level.");
  }
  return { levels, byName: new Map(levels.map((level) => [level.name, level])), defaultLevel };
}
