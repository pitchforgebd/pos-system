import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { decimalString, parseMoney } from "@/core/money";

export type ProductInput = {
  organizationId: string;
  actorId: string;
  sku: string;
  name: string;
  description?: string | null;
  brandId?: string | null;
  categoryId?: string | null;
  unitId?: string | null;
  purchasePrice: string;
  sellingPrice: string;
  wholesalePrice: string;
  minimumPrice: string;
  vatType?: string | null;
  vatValue?: string | null;
  trackStock: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  reorderLevel: string;
  warrantyAvailable: boolean;
  barcode?: string;
  ip: string;
  userAgent: string | null;
};

function slugFor(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
  return base || "product";
}

function prices(input: Pick<ProductInput, "purchasePrice" | "sellingPrice" | "wholesalePrice" | "minimumPrice" | "reorderLevel" | "vatValue">) {
  const purchasePrice = parseMoney(input.purchasePrice);
  const sellingPrice = parseMoney(input.sellingPrice);
  const wholesalePrice = parseMoney(input.wholesalePrice);
  const minimumPrice = parseMoney(input.minimumPrice);
  const reorderOk = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(input.reorderLevel);
  const vatValue = input.vatValue == null || input.vatValue === "" ? null : parseMoney(input.vatValue);
  if (!purchasePrice || !sellingPrice || !wholesalePrice || !minimumPrice || !reorderOk || (input.vatValue && !vatValue)) {
    return null;
  }
  return {
    purchasePrice,
    sellingPrice,
    wholesalePrice,
    minimumPrice,
    reorderLevel: new Prisma.Decimal(input.reorderLevel),
    vatValue,
  };
}

async function referenceExists(organizationId: string, brandId?: string | null, categoryId?: string | null, unitId?: string | null) {
  if (brandId) {
    const brand = await prisma.brand.findFirst({ where: { id: brandId, organizationId }, select: { id: true } });
    if (!brand) {
      return false;
    }
  }
  if (categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, organizationId }, select: { id: true } });
    if (!category) {
      return false;
    }
  }
  if (unitId) {
    const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId }, select: { id: true } });
    if (!unit) {
      return false;
    }
  }
  return true;
}

const productSelect = {
  id: true,
  sku: true,
  name: true,
  slug: true,
  description: true,
  purchasePrice: true,
  sellingPrice: true,
  wholesalePrice: true,
  minimumPrice: true,
  vatType: true,
  vatValue: true,
  trackStock: true,
  trackExpiry: true,
  trackBatch: true,
  trackSerial: true,
  reorderLevel: true,
  warrantyAvailable: true,
  status: true,
  brand: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  barcodes: { select: { barcode: true } },
} as const;

function present(row: {
  id: string;
  sku: string;
  name: string;
  slug: string;
  description: string | null;
  purchasePrice: Prisma.Decimal;
  sellingPrice: Prisma.Decimal;
  wholesalePrice: Prisma.Decimal;
  minimumPrice: Prisma.Decimal;
  vatType: string | null;
  vatValue: Prisma.Decimal | null;
  trackStock: boolean;
  trackExpiry: boolean;
  trackBatch: boolean;
  trackSerial: boolean;
  reorderLevel: Prisma.Decimal;
  warrantyAvailable: boolean;
  status: "ACTIVE" | "INACTIVE";
  brand: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  unit: { id: string; name: string } | null;
  barcodes: { barcode: string }[];
}) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    description: row.description,
    purchasePrice: decimalString(row.purchasePrice, 2),
    sellingPrice: decimalString(row.sellingPrice, 2),
    wholesalePrice: decimalString(row.wholesalePrice, 2),
    minimumPrice: decimalString(row.minimumPrice, 2),
    vatType: row.vatType,
    vatValue: row.vatValue ? decimalString(row.vatValue, 2) : null,
    trackStock: row.trackStock,
    trackExpiry: row.trackExpiry,
    trackBatch: row.trackBatch,
    trackSerial: row.trackSerial,
    reorderLevel: decimalString(row.reorderLevel, 4),
    warrantyAvailable: row.warrantyAvailable,
    status: row.status,
    brand: row.brand,
    category: row.category,
    unit: row.unit,
    barcodes: row.barcodes.map((barcode) => barcode.barcode),
  };
}

function stockLabel(value: Prisma.Decimal) {
  const text = value.toDecimalPlaces(4).toFixed(4).replace(/\.?0+$/, "");
  return text === "" || text === "-" ? "0" : text;
}

export async function listRegisterProducts(organizationId: string, branchId: string | null) {
  const rows = await prisma.product.findMany({
    where: { organizationId, deletedAt: null, status: "ACTIVE", trackStock: true },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      sku: true,
      name: true,
      sellingPrice: true,
      minimumPrice: true,
      vatType: true,
      vatValue: true,
      trackSerial: true,
      brandId: true,
      categoryId: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
      barcodes: { select: { barcode: true } },
      images: { take: 1, select: { id: true } },
    },
  });
  const ids = rows.map((row) => row.id);
  const balances = ids.length
    ? await prisma.stockBalance.groupBy({
        by: ["productId"],
        where: { organizationId, productId: { in: ids }, ...(branchId ? { branchId } : {}) },
        _sum: { quantity: true },
      })
    : [];
  const onHand = new Map(balances.map((row) => [row.productId, new Prisma.Decimal(row._sum.quantity ?? 0)]));
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    sellingPrice: decimalString(row.sellingPrice, 2),
    minimumPrice: decimalString(row.minimumPrice, 2),
    vatType: row.vatType,
    vatValue: row.vatValue ? decimalString(row.vatValue, 2) : null,
    trackSerial: row.trackSerial,
    brandId: row.brandId,
    brandName: row.brand?.name ?? "",
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? "",
    barcode: row.barcodes[0]?.barcode ?? "",
    barcodes: row.barcodes.map((item) => item.barcode),
    stock: stockLabel(onHand.get(row.id) ?? new Prisma.Decimal(0)),
    hasImage: row.images.length > 0,
  }));
}

export async function findRegisterProduct(organizationId: string, branchId: string | null, code: string) {
  const needle = code.trim();
  if (!needle) {
    return null;
  }
  const row = await prisma.product.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      status: "ACTIVE",
      trackStock: true,
      OR: [{ sku: needle }, { barcodes: { some: { barcode: needle } } }],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      sellingPrice: true,
      minimumPrice: true,
      vatType: true,
      vatValue: true,
      trackSerial: true,
      brandId: true,
      categoryId: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
      barcodes: { select: { barcode: true } },
      images: { take: 1, select: { id: true } },
    },
  });
  if (!row) {
    return null;
  }
  const stock = await prisma.stockBalance.aggregate({
    where: { organizationId, productId: row.id, ...(branchId ? { branchId } : {}) },
    _sum: { quantity: true },
  });
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    sellingPrice: decimalString(row.sellingPrice, 2),
    minimumPrice: decimalString(row.minimumPrice, 2),
    vatType: row.vatType,
    vatValue: row.vatValue ? decimalString(row.vatValue, 2) : null,
    trackSerial: row.trackSerial,
    brandId: row.brandId,
    brandName: row.brand?.name ?? "",
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? "",
    barcode: row.barcodes[0]?.barcode ?? "",
    barcodes: row.barcodes.map((item) => item.barcode),
    stock: stockLabel(new Prisma.Decimal(stock._sum.quantity ?? 0)),
    hasImage: row.images.length > 0,
  };
}

const catalogSizes = [25, 50, 100, 200] as const;

export async function listCatalogTable(
  organizationId: string,
  input: { search?: string | null; page?: number | null; size?: number | null; status?: string | null },
) {
  const size = catalogSizes.find((item) => item === input.size) ?? 25;
  const search = input.search?.trim() ?? "";
  const status = input.status === "ACTIVE" || input.status === "INACTIVE" ? input.status : undefined;
  const where: Prisma.ProductWhereInput = {
    organizationId,
    deletedAt: null,
    status,
    ...(search ? { OR: [{ name: { contains: search } }, { sku: { contains: search } }] } : {}),
  };
  const total = await prisma.product.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(input.page && input.page > 0 ? input.page : 1, 1), pageCount);
  const rows = await prisma.product.findMany({
    where,
    orderBy: { name: "asc" },
    skip: (page - 1) * size,
    take: size,
    select: {
      id: true,
      sku: true,
      name: true,
      purchasePrice: true,
      sellingPrice: true,
      status: true,
      images: { take: 1, select: { id: true } },
    },
  });
  const ids = rows.map((row) => row.id);
  const balances = ids.length
    ? await prisma.stockBalance.groupBy({
        by: ["productId"],
        where: { organizationId, productId: { in: ids } },
        _sum: { quantity: true },
      })
    : [];
  // What the stock is worth: each warehouse's quantity at its moving-average cost.
  const worth = ids.length
    ? await prisma.$queryRaw<Array<{ productId: string; value: Prisma.Decimal | null }>>`
        SELECT productId, SUM(ROUND(quantity * COALESCE(averageCost, 0), 2)) AS value
        FROM stock_balances WHERE organizationId = ${organizationId} AND productId IN (${Prisma.join(ids)}) GROUP BY productId`
    : [];
  const stockValue = new Map(worth.map((row) => [row.productId, new Prisma.Decimal(row.value ?? 0)]));
  const movements = ids.length
    ? await prisma.stockLedger.groupBy({
        by: ["productId", "direction", "movementType"],
        where: { organizationId, productId: { in: ids } },
        _sum: { quantity: true },
      })
    : [];
  const onHand = new Map(balances.map((row) => [row.productId, new Prisma.Decimal(row._sum.quantity ?? 0)]));
  const stockIn = new Map<string, Prisma.Decimal>();
  const stockOut = new Map<string, Prisma.Decimal>();
  const returned = new Map<string, Prisma.Decimal>();
  for (const row of movements) {
    const quantity = new Prisma.Decimal(row._sum.quantity ?? 0);
    if (row.movementType === "CUSTOMER_RETURN") {
      returned.set(row.productId, (returned.get(row.productId) ?? new Prisma.Decimal(0)).plus(quantity));
    } else if (row.direction === "IN") {
      stockIn.set(row.productId, (stockIn.get(row.productId) ?? new Prisma.Decimal(0)).plus(quantity));
    } else {
      stockOut.set(row.productId, (stockOut.get(row.productId) ?? new Prisma.Decimal(0)).plus(quantity));
    }
  }
  return {
    total,
    page,
    size,
    pageCount,
    rows: rows.map((row) => {
      const current = onHand.get(row.id) ?? new Prisma.Decimal(0);
      return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        purchasePrice: decimalString(row.purchasePrice, 2),
        sellingPrice: decimalString(row.sellingPrice, 2),
        status: row.status,
        hasImage: row.images.length > 0,
        stockIn: decimalString(stockIn.get(row.id) ?? 0, 4),
        stockOut: decimalString(stockOut.get(row.id) ?? 0, 4),
        totalReturn: decimalString(returned.get(row.id) ?? 0, 4),
        currentStock: decimalString(current, 4),
        stockValue: (stockValue.get(row.id) ?? new Prisma.Decimal(0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
        sellingValue: current.mul(row.sellingPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      };
    }),
  };
}

export async function listProducts(organizationId: string, search?: string) {
  const rows = await prisma.product.findMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: search ? [{ name: { contains: search } }, { sku: { contains: search } }] : undefined,
    },
    orderBy: { name: "asc" },
    take: 200,
    select: productSelect,
  });
  return rows.map(present);
}

export async function getProduct(organizationId: string, id: string) {
  const row = await prisma.product.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: productSelect,
  });
  return row ? present(row) : null;
}

async function uniqueSlug(organizationId: string, name: string) {
  const base = slugFor(name);
  for (let index = 0; index < 20; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await prisma.product.findFirst({ where: { organizationId, slug }, select: { id: true } });
    if (!existing) {
      return slug;
    }
  }
  return null;
}

export async function createProduct(input: ProductInput) {
  const money = prices(input);
  if (!money) {
    return { ok: false as const, status: 422 as const, message: "Enter prices with up to two decimals and a reorder level with up to four." };
  }
  if (!(await referenceExists(input.organizationId, input.brandId, input.categoryId, input.unitId))) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  const sku = input.sku.trim();
  const slug = await uniqueSlug(input.organizationId, input.name);
  if (!slug) {
    return { ok: false as const, status: 409 as const, message: "Choose a different product name." };
  }
  try {
    const row = await prisma.product.create({
      data: {
        organizationId: input.organizationId,
        sku,
        liveSku: sku,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        brandId: input.brandId || null,
        categoryId: input.categoryId || null,
        unitId: input.unitId || null,
        ...money,
        vatType: input.vatType?.trim() || null,
        trackStock: input.trackStock,
        trackExpiry: input.trackExpiry,
        // an expiry-tracked product always has lots (batches): there is no separate flag to set (L7)
        trackBatch: input.trackExpiry,
        trackSerial: input.trackSerial,
        warrantyAvailable: input.warrantyAvailable,
        createdById: input.actorId,
        barcodes: input.barcode ? { create: { organizationId: input.organizationId, barcode: input.barcode.trim() } } : undefined,
      },
      select: productSelect,
    });
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.actorId,
      action: "create",
      module: "products",
      entityType: "product",
      entityId: row.id,
      after: { sku: row.sku, name: row.name },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true as const, product: present(row) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, status: 409 as const, message: "That SKU or barcode already exists." };
    }
    throw error;
  }
}

export async function updateProduct(input: ProductInput & { productId: string }) {
  const current = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId, deletedAt: null },
    select: { id: true, sku: true, name: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  const money = prices(input);
  if (!money) {
    return { ok: false as const, status: 422 as const, message: "Enter prices with up to two decimals and a reorder level with up to four." };
  }
  if (!(await referenceExists(input.organizationId, input.brandId, input.categoryId, input.unitId))) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  const sku = input.sku.trim();
  try {
    const row = await prisma.product.update({
      where: { id: current.id },
      data: {
        sku,
        liveSku: sku,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        brandId: input.brandId || null,
        categoryId: input.categoryId || null,
        unitId: input.unitId || null,
        ...money,
        vatType: input.vatType?.trim() || null,
        trackStock: input.trackStock,
        trackExpiry: input.trackExpiry,
        // an expiry-tracked product always has lots (batches): there is no separate flag to set (L7)
        trackBatch: input.trackExpiry,
        trackSerial: input.trackSerial,
        warrantyAvailable: input.warrantyAvailable,
        updatedById: input.actorId,
      },
      select: productSelect,
    });
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.actorId,
      action: "update",
      module: "products",
      entityType: "product",
      entityId: row.id,
      before: { sku: current.sku, name: current.name },
      after: { sku: row.sku, name: row.name },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true as const, product: present(row) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, status: 409 as const, message: "That SKU already exists." };
    }
    throw error;
  }
}

export async function disableProduct(input: {
  organizationId: string;
  actorId: string;
  productId: string;
  ip: string;
  userAgent: string | null;
}) {
  const current = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId, deletedAt: null },
    select: { id: true, sku: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  await prisma.product.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), liveSku: null, status: "INACTIVE", updatedById: input.actorId },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "update",
    module: "products",
    entityType: "product",
    entityId: current.id,
    before: { sku: current.sku, deletedAt: null },
    after: { deletedAt: true },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const };
}

export async function addVariant(input: {
  organizationId: string;
  productId: string;
  sku: string;
  price?: string;
  barcode?: string;
}) {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!product) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  const price = input.price ? parseMoney(input.price) : null;
  if (input.price && !price) {
    return { ok: false as const, status: 422 as const, message: "Enter a price with up to two decimals." };
  }
  try {
    const row = await prisma.productVariant.create({
      data: {
        organizationId: input.organizationId,
        productId: product.id,
        sku: input.sku.trim(),
        price,
        barcodes: input.barcode
          ? { create: { organizationId: input.organizationId, productId: product.id, barcode: input.barcode.trim() } }
          : undefined,
      },
      select: { id: true, sku: true, price: true },
    });
    return {
      ok: true as const,
      variant: { id: row.id, sku: row.sku, price: row.price ? decimalString(row.price, 2) : null },
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, status: 409 as const, message: "That SKU or barcode already exists." };
    }
    throw error;
  }
}

export async function addBarcode(input: { organizationId: string; productId: string; barcode: string; variantId?: string }) {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!product) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  try {
    const row = await prisma.productBarcode.create({
      data: {
        organizationId: input.organizationId,
        productId: product.id,
        variantId: input.variantId ?? null,
        barcode: input.barcode.trim(),
      },
      select: { id: true, barcode: true },
    });
    return { ok: true as const, barcode: row };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, status: 409 as const, message: "That barcode already exists." };
    }
    throw error;
  }
}
