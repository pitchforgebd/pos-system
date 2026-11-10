import { Prisma, type PrismaClient } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { runTx } from "@/core/tx/run";
import { decimalString } from "@/core/money";
import { ensurePriceLevels } from "@/modules/pricing/levels";

// Which price a product sells at (D6, P04 task 2). The price level is chosen first (named, or the customer type's, or the default),
// then the largest quantity step not above the quantity. A variant's own price comes before the product's at the same level. A level
// with no price for that quantity falls back to the default level (Retail). The price is never below the product's minimum price.

type Db = Prisma.TransactionClient | PrismaClient;

export type PriceRow = { variantScope: string; priceLevelId: string; minQty: Prisma.Decimal; price: Prisma.Decimal };

export type PickedPrice = {
  price: Prisma.Decimal;
  levelId: string;
  minQty: Prisma.Decimal;
  /** The price is the variant's own, not the product's. */
  ownVariantPrice: boolean;
  /** The chosen level had no price for this quantity, so the default level answered. */
  fellBack: boolean;
  /** The price was lifted to the minimum price. */
  floored: boolean;
};

/** The best row among `rows` for a quantity: the largest step (minQty) not above it. */
function bestStep(rows: PriceRow[], quantity: Prisma.Decimal) {
  let best: PriceRow | null = null;
  for (const row of rows) {
    if (row.minQty.lte(quantity) && (!best || row.minQty.gt(best.minQty))) {
      best = row;
    }
  }
  return best;
}

/**
 * The pure rule. Looks, in order, at the variant's prices at the level, the product's prices at the level, then the same two at the
 * default level; the first of them with a step that fits the quantity wins. Null when the product has no price that fits at all.
 */
export function pickPrice(input: {
  rows: PriceRow[];
  variantId?: string | null;
  levelId: string;
  defaultLevelId: string;
  quantity: Prisma.Decimal;
  minimumPrice: Prisma.Decimal;
}): PickedPrice | null {
  const variantScope = input.variantId ?? "";
  const attempts: Array<{ levelId: string; scope: string }> = [
    ...(variantScope ? [{ levelId: input.levelId, scope: variantScope }] : []),
    { levelId: input.levelId, scope: "" },
  ];
  if (input.levelId !== input.defaultLevelId) {
    attempts.push(...(variantScope ? [{ levelId: input.defaultLevelId, scope: variantScope }] : []), { levelId: input.defaultLevelId, scope: "" });
  }
  for (const attempt of attempts) {
    const found = bestStep(input.rows.filter((row) => row.priceLevelId === attempt.levelId && row.variantScope === attempt.scope), input.quantity);
    if (found) {
      const floored = found.price.lt(input.minimumPrice);
      return {
        price: floored ? input.minimumPrice : found.price,
        levelId: attempt.levelId,
        minQty: found.minQty,
        ownVariantPrice: attempt.scope !== "",
        fellBack: attempt.levelId !== input.levelId,
        floored,
      };
    }
  }
  return null;
}

export type ResolvedPrice = PickedPrice & { levelName: string; priceText: string };

/** The price of a product (or variant) for a quantity, at the level named, or the customer type's level, or the default level. */
export async function resolvePrice(
  db: Db,
  input: { organizationId: string; productId: string; variantId?: string | null; quantity: string; level?: string; levelId?: string; customerTypeId?: string | null },
): Promise<ResolvedPrice | null> {
  const product = await db.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId, deletedAt: null },
    select: { minimumPrice: true },
  });
  if (!product) {
    throw new RuleError("That record was not found.", 404);
  }
  if (!/^\d{1,14}(\.\d{1,4})?$/.test(input.quantity) || new Prisma.Decimal(input.quantity).lte(0)) {
    throw new RuleError("Enter a quantity greater than zero.");
  }
  const { levels, defaultLevel } = await ensurePriceLevels(db, input.organizationId);
  let levelId = input.levelId ?? defaultLevel.id;
  if (input.level) {
    const named = levels.find((level) => level.name === input.level);
    if (!named) {
      throw new RuleError("That price level does not exist.");
    }
    levelId = named.id;
  } else if (!input.levelId && input.customerTypeId) {
    const type = await db.customerType.findFirst({ where: { id: input.customerTypeId, organizationId: input.organizationId }, select: { priceLevelId: true } });
    levelId = type?.priceLevelId ?? defaultLevel.id;
  }
  const rows = await db.productPrice.findMany({
    where: { organizationId: input.organizationId, productId: input.productId },
    select: { variantScope: true, priceLevelId: true, minQty: true, price: true },
  });
  const picked = pickPrice({
    rows: rows.map((row) => ({ variantScope: row.variantScope, priceLevelId: row.priceLevelId, minQty: new Prisma.Decimal(row.minQty), price: new Prisma.Decimal(row.price) })),
    variantId: input.variantId,
    levelId,
    defaultLevelId: defaultLevel.id,
    quantity: new Prisma.Decimal(input.quantity),
    minimumPrice: new Prisma.Decimal(product.minimumPrice),
  });
  if (!picked) {
    return null;
  }
  return { ...picked, levelName: levels.find((level) => level.id === picked.levelId)?.name ?? "", priceText: decimalString(picked.price, 2) };
}

export type PriceEntry = {
  productId: string;
  sellingPrice: Prisma.Decimal;
  minimumPrice: Prisma.Decimal;
  /** Every price row of the product, variants included. */
  rows: PriceRow[];
  /** The price for the quantity asked at the level (null: the product has no price that fits). */
  picked: PickedPrice | null;
  /** The product's own steps at the level the price came from, smallest quantity first. */
  steps: Array<{ minQty: Prisma.Decimal; price: Prisma.Decimal }>;
};

/**
 * The prices of many products at once, at one level (named, given, the customer type's, or the default), for one quantity. For a list
 * (search, labels) where asking one product at a time would be a query each. Refuses a level name that does not exist.
 */
export async function pricesFor(
  db: Db,
  input: { organizationId: string; productIds: string[]; quantity?: string; level?: string; levelId?: string; customerTypeId?: string | null },
): Promise<{ levelId: string; levelName: string; defaultLevelId: string; levels: Array<{ id: string; name: string }>; byProduct: Map<string, PriceEntry> }> {
  const { levels, defaultLevel } = await ensurePriceLevels(db, input.organizationId);
  let levelId = input.levelId ?? defaultLevel.id;
  if (input.level) {
    const named = levels.find((level) => level.name === input.level);
    if (!named) {
      throw new RuleError("That price level does not exist.");
    }
    levelId = named.id;
  } else if (!input.levelId && input.customerTypeId) {
    const type = await db.customerType.findFirst({ where: { id: input.customerTypeId, organizationId: input.organizationId }, select: { priceLevelId: true } });
    levelId = type?.priceLevelId ?? defaultLevel.id;
  }
  const byProduct = new Map<string, PriceEntry>();
  if (input.productIds.length > 0) {
    const [products, rows] = await Promise.all([
      db.product.findMany({ where: { organizationId: input.organizationId, id: { in: input.productIds } }, select: { id: true, sellingPrice: true, minimumPrice: true } }),
      db.productPrice.findMany({ where: { organizationId: input.organizationId, productId: { in: input.productIds } }, select: { productId: true, variantScope: true, priceLevelId: true, minQty: true, price: true } }),
    ]);
    const quantity = new Prisma.Decimal(input.quantity ?? "1");
    for (const product of products) {
      const mine: PriceRow[] = rows
        .filter((row) => row.productId === product.id)
        .map((row) => ({ variantScope: row.variantScope, priceLevelId: row.priceLevelId, minQty: new Prisma.Decimal(row.minQty), price: new Prisma.Decimal(row.price) }));
      const picked = pickPrice({ rows: mine, levelId, defaultLevelId: defaultLevel.id, quantity, minimumPrice: new Prisma.Decimal(product.minimumPrice) });
      const stepLevel = picked?.levelId ?? levelId;
      byProduct.set(product.id, {
        productId: product.id,
        sellingPrice: new Prisma.Decimal(product.sellingPrice),
        minimumPrice: new Prisma.Decimal(product.minimumPrice),
        rows: mine,
        picked,
        steps: mine.filter((row) => row.variantScope === "" && row.priceLevelId === stepLevel).sort((a, b) => a.minQty.comparedTo(b.minQty)).map((row) => ({ minQty: row.minQty, price: row.price })),
      });
    }
  }
  return { levelId, levelName: levels.find((level) => level.id === levelId)?.name ?? "", defaultLevelId: defaultLevel.id, levels: levels.map((level) => ({ id: level.id, name: level.name })), byProduct };
}

export type PriceStep = { level: string; minQty: string; price: string };

/**
 * Replaces the price steps of a product (or of one variant): level, from quantity, price. The product's own Retail and Wholesale
 * columns follow the first step of those levels (the rest of the system still reads them), a variant's price follows its first Retail
 * step. Refuses an unknown level, a quantity or price that is not valid, or the same level and quantity twice; a refused list changes nothing.
 */
export async function setPrices(db: Db, input: { organizationId: string; productId: string; variantId?: string | null; prices: PriceStep[] }) {
  const write = async (tx: Prisma.TransactionClient) => {
    const product = await tx.product.findFirst({ where: { id: input.productId, organizationId: input.organizationId, deletedAt: null }, select: { id: true } });
    if (!product) {
      throw new RuleError("That record was not found.", 404);
    }
    if (input.variantId) {
      const variant = await tx.productVariant.findFirst({ where: { id: input.variantId, productId: input.productId, organizationId: input.organizationId }, select: { id: true } });
      if (!variant) {
        throw new RuleError("That record was not found.", 404);
      }
    }
    const { levels } = await ensurePriceLevels(tx, input.organizationId);
    const seen: Array<{ levelId: string; minQty: Prisma.Decimal }> = [];
    const rows = input.prices.map((step) => {
      const level = levels.find((candidate) => candidate.name === step.level);
      if (!level) {
        throw new RuleError("That price level does not exist.");
      }
      if (!/^\d{1,14}(\.\d{1,4})?$/.test(step.minQty) || new Prisma.Decimal(step.minQty).lte(0)) {
        throw new RuleError("The quantity a price starts at must be greater than zero, with up to four decimals.");
      }
      if (!/^\d{1,16}(\.\d{1,2})?$/.test(step.price)) {
        throw new RuleError("Enter a price with up to two decimals.");
      }
      const minQty = new Prisma.Decimal(step.minQty);
      if (seen.some((other) => other.levelId === level.id && other.minQty.eq(minQty))) {
        throw new RuleError(`The ${level.name} price from quantity ${step.minQty} is listed twice.`);
      }
      seen.push({ levelId: level.id, minQty });
      return { level, minQty, price: new Prisma.Decimal(step.price) };
    });
    const variantScope = input.variantId ?? "";
    await tx.productPrice.deleteMany({ where: { organizationId: input.organizationId, productId: input.productId, variantScope } });
    for (const row of rows) {
      await tx.productPrice.create({
        data: {
          organizationId: input.organizationId,
          productId: input.productId,
          variantId: input.variantId ?? null,
          variantScope,
          priceLevelId: row.level.id,
          minQty: row.minQty,
          price: row.price,
        },
      });
    }
    const firstOf = (name: string) =>
      rows.filter((row) => row.level.name === name).sort((a, b) => a.minQty.comparedTo(b.minQty))[0]?.price;
    const retail = firstOf("Retail");
    if (input.variantId) {
      if (retail) {
        await tx.productVariant.update({ where: { id: input.variantId }, data: { price: retail } });
      }
    } else {
      const wholesale = firstOf("Wholesale");
      if (retail || wholesale) {
        await tx.product.update({ where: { id: input.productId }, data: { ...(retail ? { sellingPrice: retail } : {}), ...(wholesale ? { wholesalePrice: wholesale } : {}) } });
      }
    }
    return rows.length;
  };
  return "$transaction" in db ? runTx(write) : write(db);
}

/**
 * Keeps the price list in step with the product's own Retail and Wholesale prices: the step from quantity 1 of each level is set to
 * the price on the product (created if it is not there). Other steps are left alone.
 */
export async function syncBasePrices(db: Db, input: { organizationId: string; productId: string; sellingPrice: Prisma.Decimal; wholesalePrice: Prisma.Decimal }) {
  const { byName } = await ensurePriceLevels(db, input.organizationId);
  for (const [name, price] of [["Retail", input.sellingPrice], ["Wholesale", input.wholesalePrice]] as const) {
    const level = byName.get(name);
    if (!level) {
      continue;
    }
    const existing = await db.productPrice.findFirst({
      where: { organizationId: input.organizationId, productId: input.productId, variantScope: "", priceLevelId: level.id, minQty: 1 },
      select: { id: true },
    });
    if (existing) {
      await db.productPrice.update({ where: { id: existing.id }, data: { price } });
    } else {
      await db.productPrice.create({ data: { organizationId: input.organizationId, productId: input.productId, variantId: null, variantScope: "", priceLevelId: level.id, minQty: 1, price } });
    }
  }
}
