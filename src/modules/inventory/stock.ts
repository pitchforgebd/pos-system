import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import { decimalString } from "@/core/money";

// The stock engine lives in core/stock; these names stay importable from here.
export { addExpiryLots, applyMovement, currentUnitCost, nextAverageCost, StockRuleError } from "@/core/stock";
export type { ConsumedLot } from "@/core/stock";

export function alertStatus(quantity: Prisma.Decimal, reorderLevel: Prisma.Decimal) {
  if (quantity.eq(0)) {
    return "OUT_OF_STOCK" as const;
  }
  if (quantity.gt(0) && quantity.lte(reorderLevel)) {
    return "LOW" as const;
  }
  if (quantity.gt(reorderLevel)) {
    return "NORMAL" as const;
  }
  return "OUT_OF_STOCK" as const;
}

export async function resolveWarehouse(organizationId: string, branchId: string, warehouseId?: string) {
  if (warehouseId) {
    return prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId, branchId, status: "ACTIVE" },
      select: { id: true, name: true },
    });
  }
  const rows = await prisma.warehouse.findMany({
    where: { organizationId, branchId, status: "ACTIVE" },
    select: { id: true, name: true },
    take: 2,
    orderBy: { name: "asc" },
  });
  return rows.length === 1 ? rows[0] : null;
}

const balanceSelect = {
  id: true,
  productId: true,
  variantId: true,
  quantity: true,
  product: { select: { sku: true, name: true, reorderLevel: true, purchasePrice: true, sellingPrice: true, brandId: true, categoryId: true } },
  variant: { select: { sku: true } },
  warehouse: { select: { id: true, name: true } },
} as const;

function presentBalance(row: {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: Prisma.Decimal;
  product: {
    sku: string;
    name: string;
    reorderLevel: Prisma.Decimal;
    purchasePrice: Prisma.Decimal;
    sellingPrice: Prisma.Decimal;
    brandId: string | null;
    categoryId: string | null;
  };
  variant: { sku: string } | null;
  warehouse: { id: string; name: string };
}) {
  const quantity = new Prisma.Decimal(row.quantity);
  return {
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    sku: row.variant?.sku ?? row.product.sku,
    name: row.product.name,
    warehouseId: row.warehouse.id,
    warehouseName: row.warehouse.name,
    quantity: decimalString(quantity, 4),
    reorderLevel: decimalString(row.product.reorderLevel, 4),
    alert: alertStatus(quantity, new Prisma.Decimal(row.product.reorderLevel)),
    brandId: row.product.brandId,
    categoryId: row.product.categoryId,
    purchaseValue: decimalString(quantity.mul(row.product.purchasePrice), 2),
    saleValue: decimalString(quantity.mul(row.product.sellingPrice), 2),
  };
}

export async function listStock(input: {
  organizationId: string;
  branchId: string;
  search?: string;
  brandId?: string;
  categoryId?: string;
  alert?: "NORMAL" | "LOW" | "OUT_OF_STOCK";
}) {
  const rows = await prisma.stockBalance.findMany({
    where: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      product: {
        deletedAt: null,
        brandId: input.brandId,
        categoryId: input.categoryId,
        OR: input.search
          ? [{ name: { contains: input.search } }, { sku: { contains: input.search } }]
          : undefined,
      },
    },
    select: balanceSelect,
    orderBy: { product: { name: "asc" } },
    take: 200,
  });
  const presented = rows.map(presentBalance);
  return input.alert ? presented.filter((row) => row.alert === input.alert) : presented;
}

export async function listLedger(organizationId: string, branchId: string, search?: string) {
  const needle = search?.trim();
  const rows = await prisma.stockLedger.findMany({
    where: {
      organizationId,
      branchId,
      ...(needle ? { product: { OR: [{ name: { contains: needle } }, { sku: { contains: needle } }] } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      quantity: true,
      direction: true,
      movementType: true,
      referenceType: true,
      referenceId: true,
      unitCost: true,
      createdAt: true,
      product: { select: { sku: true, name: true } },
      warehouse: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    sku: row.product.sku,
    name: row.product.name,
    warehouseName: row.warehouse?.name ?? "",
    quantity: decimalString(row.quantity, 4),
    direction: row.direction,
    movementType: row.movementType,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    unitCost: row.unitCost ? decimalString(row.unitCost, 2) : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function stockSummary(organizationId: string, branchId: string) {
  const [row] = await prisma.$queryRaw<
    { quantity: Prisma.Decimal; purchaseValue: Prisma.Decimal; saleValue: Prisma.Decimal; rowCount: bigint }[]
  >(Prisma.sql`
    SELECT
      COALESCE(SUM(sb.quantity), 0) AS quantity,
      COALESCE(SUM(ROUND(sb.quantity * p.purchasePrice, 2)), 0) AS purchaseValue,
      COALESCE(SUM(ROUND(sb.quantity * p.sellingPrice, 2)), 0) AS saleValue,
      COUNT(sb.id) AS rowCount
    FROM stock_balances sb
    INNER JOIN products p ON p.id = sb.productId
    WHERE sb.organizationId = ${organizationId}
      AND sb.branchId = ${branchId}
      AND p.deletedAt IS NULL
  `);
  return {
    quantity: decimalString(new Prisma.Decimal(row?.quantity ?? 0), 4),
    purchaseValue: decimalString(new Prisma.Decimal(row?.purchaseValue ?? 0), 2),
    saleValue: decimalString(new Prisma.Decimal(row?.saleValue ?? 0), 2),
    rows: Number(row?.rowCount ?? 0),
  };
}

export async function ledgerMatchesBalance(organizationId: string, branchId: string) {
  const balances = await prisma.stockBalance.findMany({
    where: { organizationId, branchId },
    select: { productId: true, variantScope: true, warehouseId: true, quantity: true },
  });
  const ledgers = await prisma.stockLedger.findMany({
    where: { organizationId, branchId },
    select: { productId: true, variantId: true, warehouseId: true, quantity: true, direction: true },
  });
  for (const balance of balances) {
    let summed = new Prisma.Decimal(0);
    for (const ledger of ledgers) {
      const scope = ledger.variantId ?? "";
      if (ledger.productId !== balance.productId || scope !== balance.variantScope || ledger.warehouseId !== balance.warehouseId) {
        continue;
      }
      summed = ledger.direction === "IN" ? summed.plus(ledger.quantity) : summed.minus(ledger.quantity);
    }
    if (!summed.eq(balance.quantity)) {
      return false;
    }
  }
  return true;
}
