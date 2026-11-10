import { businessDate } from "../src/core/time/business-date.ts";
import { prisma } from "../src/lib/db/client.ts";
import { createProduct } from "../src/modules/catalog/products.ts";
import { createBrand, createCategory, createUnit } from "../src/modules/catalog/references.ts";
import { createCustomer } from "../src/modules/customers/customers.ts";
import { postOpeningStock } from "../src/modules/inventory/documents.ts";
import { createSupplier } from "../src/modules/purchasing/suppliers.ts";
import { postSale } from "../src/modules/sales/sales.ts";

const actor = { ip: "127.0.0.1", userAgent: "demo-seed" };

const catalog = [
  { sku: "DEMO-RICE", name: "Miniket Rice 25kg", barcode: "8941000000001", brand: "Fresh", category: "Grocery", unit: "Bag", purchase: "1800.00", sell: "1950.00", qty: "30" },
  { sku: "DEMO-OIL", name: "Soybean Oil 5L", barcode: "8941000000002", brand: "Fresh", category: "Grocery", unit: "Bottle", purchase: "820.00", sell: "920.00", qty: "24" },
  { sku: "DEMO-SUGAR", name: "Sugar 1kg", barcode: "8941000000003", brand: "Fresh", category: "Grocery", unit: "Kg", purchase: "95.00", sell: "110.00", qty: "80" },
  { sku: "DEMO-DAL", name: "Lentil 1kg", barcode: "8941000000004", brand: "Daily", category: "Grocery", unit: "Kg", purchase: "130.00", sell: "150.00", qty: "40" },
  { sku: "DEMO-MILK", name: "Milk Powder 500g", barcode: "8941000000005", brand: "Daily", category: "Grocery", unit: "Pcs", purchase: "280.00", sell: "320.00", qty: "36" },
  { sku: "DEMO-SOAP", name: "Bath Soap", barcode: "8941000000006", brand: "Home", category: "Personal Care", unit: "Pcs", purchase: "35.00", sell: "45.00", qty: "60" },
  { sku: "DEMO-PASTE", name: "Toothpaste", barcode: "8941000000007", brand: "Home", category: "Personal Care", unit: "Pcs", purchase: "70.00", sell: "90.00", qty: "40" },
  { sku: "DEMO-TEA", name: "Tea 400g", barcode: "8941000000008", brand: "Daily", category: "Grocery", unit: "Pcs", purchase: "180.00", sell: "210.00", qty: "25" },
  { sku: "DEMO-SALT", name: "Salt 1kg", barcode: "8941000000009", brand: "Fresh", category: "Grocery", unit: "Kg", purchase: "28.00", sell: "35.00", qty: "50" },
  { sku: "DEMO-FLOUR", name: "Flour 2kg", barcode: "8941000000010", brand: "Fresh", category: "Grocery", unit: "Kg", purchase: "90.00", sell: "110.00", qty: "40" },
  { sku: "DEMO-EGG", name: "Eggs 12pcs", barcode: "8941000000011", brand: "Daily", category: "Grocery", unit: "Pcs", purchase: "140.00", sell: "160.00", qty: "20" },
  { sku: "DEMO-DRINK", name: "Soft Drink 1L", barcode: "8941000000012", brand: "Home", category: "Beverage", unit: "Bottle", purchase: "70.00", sell: "90.00", qty: "48" },
] as const;

async function namedId(kind: "brand" | "category" | "unit", organizationId: string, name: string) {
  const where = { organizationId, name };
  const found =
    kind === "brand"
      ? await prisma.brand.findFirst({ where, select: { id: true } })
      : kind === "category"
        ? await prisma.category.findFirst({ where, select: { id: true } })
        : await prisma.unit.findFirst({ where, select: { id: true } });
  if (found) {
    return found.id;
  }
  const created =
    kind === "brand"
      ? await createBrand({ organizationId, name })
      : kind === "category"
        ? await createCategory({ organizationId, name })
        : await createUnit({ organizationId, name });
  if (!created.ok) {
    throw new Error(created.message);
  }
  return created.row.id;
}

async function ensureCustomer(input: {
  organizationId: string;
  actorId: string;
  branchId: string;
  name: string;
  phone: string;
  openingBalance: string;
  customerTypeId?: string;
}) {
  const existing = await prisma.customer.findFirst({
    where: { organizationId: input.organizationId, phone: input.phone },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }
  const created = await createCustomer({ ...input, ...actor });
  if (!created.ok) {
    throw new Error(created.message);
  }
  return created.customer.id;
}

export async function seedDemoContent() {
  const organization = await prisma.organization.findUnique({ where: { slug: "meridian" }, select: { id: true } });
  if (!organization) {
    return;
  }
  const user = await prisma.user.findFirst({
    where: { organizationId: organization.id, roles: { some: { role: { name: "Super Admin" } } } },
    select: { id: true },
  });
  const branch = await prisma.branch.findFirst({ where: { organizationId: organization.id, name: "Main" }, select: { id: true } });
  const warehouse = branch
    ? await prisma.warehouse.findFirst({
        where: { organizationId: organization.id, branchId: branch.id, name: "Main" },
        select: { id: true },
      })
    : null;
  if (!user || !branch || !warehouse) {
    return;
  }

  const brandIds = new Map<string, string>();
  const categoryIds = new Map<string, string>();
  const unitIds = new Map<string, string>();
  for (const item of catalog) {
    if (!brandIds.has(item.brand)) {
      brandIds.set(item.brand, await namedId("brand", organization.id, item.brand));
    }
    if (!categoryIds.has(item.category)) {
      categoryIds.set(item.category, await namedId("category", organization.id, item.category));
    }
    if (!unitIds.has(item.unit)) {
      unitIds.set(item.unit, await namedId("unit", organization.id, item.unit));
    }
  }

  const productIds = new Map<string, string>();
  for (const item of catalog) {
    const existing = await prisma.product.findFirst({
      where: { organizationId: organization.id, sku: item.sku, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      productIds.set(item.sku, existing.id);
      continue;
    }
    const created = await createProduct({
      organizationId: organization.id,
      actorId: user.id,
      sku: item.sku,
      name: item.name,
      brandId: brandIds.get(item.brand),
      categoryId: categoryIds.get(item.category),
      unitId: unitIds.get(item.unit),
      purchasePrice: item.purchase,
      sellingPrice: item.sell,
      wholesalePrice: item.sell,
      minimumPrice: item.purchase,
      trackStock: true,
      trackExpiry: false,
      trackSerial: false,
      reorderLevel: "5",
      warrantyAvailable: false,
      barcode: item.barcode,
      ...actor,
    });
    if (!created.ok) {
      throw new Error(`${item.sku}: ${created.message}`);
    }
    productIds.set(item.sku, created.product.id);
  }

  const ids = [...productIds.values()];
  const opened = await prisma.stockLedger.count({
    where: { organizationId: organization.id, productId: { in: ids }, movementType: "OPENING" },
  });
  if (opened === 0) {
    const stock = await postOpeningStock({
      organizationId: organization.id,
      branchId: branch.id,
      userId: user.id,
      warehouseId: warehouse.id,
      idempotencyKey: "demo-opening-stock",
      businessDate: businessDate(),
      lines: catalog.map((item) => ({
        productId: productIds.get(item.sku) ?? "",
        quantity: item.qty,
        unitCost: item.purchase,
      })),
      ...actor,
    });
    if (!stock.ok) {
      throw new Error(stock.message);
    }
  }

  const dealerType = await prisma.customerType.findFirst({
    where: { organizationId: organization.id, name: "Dealer" },
    select: { id: true },
  });
  const dealerTypeId =
    dealerType?.id ??
    (
      await prisma.customerType.create({
        data: { organizationId: organization.id, name: "Dealer" },
        select: { id: true },
      })
    ).id;

  const dealerId = await ensureCustomer({
    organizationId: organization.id,
    actorId: user.id,
    branchId: branch.id,
    name: "Rahim Store",
    phone: "01711000001",
    openingBalance: "2500.00",
    customerTypeId: dealerTypeId,
  });
  await prisma.customer.update({ where: { id: dealerId }, data: { customerTypeId: dealerTypeId } });
  await ensureCustomer({
    organizationId: organization.id,
    actorId: user.id,
    branchId: branch.id,
    name: "Ayesha Begum",
    phone: "01711000002",
    openingBalance: "0.00",
  });
  await ensureCustomer({
    organizationId: organization.id,
    actorId: user.id,
    branchId: branch.id,
    name: "Karim Traders",
    phone: "01711000003",
    openingBalance: "800.00",
  });

  for (const supplier of [
    { name: "City Wholesale", phone: "01811000001", openingPayable: "12000.00" },
    { name: "Delta Distributors", phone: "01811000002", openingPayable: "0.00" },
  ]) {
    const existing = await prisma.supplier.findFirst({
      where: { organizationId: organization.id, name: supplier.name },
      select: { id: true },
    });
    if (existing) {
      continue;
    }
    const created = await createSupplier({
      organizationId: organization.id,
      actorId: user.id,
      branchId: branch.id,
      name: supplier.name,
      phone: supplier.phone,
      openingPayable: supplier.openingPayable,
      ...actor,
    });
    if (!created.ok) {
      throw new Error(created.message);
    }
  }

  const day = businessDate();
  const rice = productIds.get("DEMO-RICE");
  const oil = productIds.get("DEMO-OIL");
  const sugar = productIds.get("DEMO-SUGAR");
  if (!rice || !oil || !sugar) {
    return;
  }
  const cashSale = await postSale({
    organizationId: organization.id,
    branchId: branch.id,
    userId: user.id,
    warehouseId: warehouse.id,
    idempotencyKey: "demo-sale-cash",
    businessDate: day,
    lines: [
      { productId: rice, quantity: "2" },
      { productId: oil, quantity: "1" },
    ],
    paymentAmount: "4820.00",
    paymentMethod: "CASH",
    ...actor,
  });
  if (!cashSale.ok) {
    throw new Error(cashSale.message);
  }
  const dueSale = await postSale({
    organizationId: organization.id,
    branchId: branch.id,
    userId: user.id,
    warehouseId: warehouse.id,
    idempotencyKey: "demo-sale-due",
    businessDate: day,
    customerId: dealerId,
    lines: [{ productId: sugar, quantity: "3" }],
    paymentAmount: "0.00",
    paymentMethod: "CASH",
    ...actor,
  });
  if (!dueSale.ok) {
    throw new Error(dueSale.message);
  }
  console.log(`Demo content ready: ${catalog.length} products, 3 customers, 2 suppliers.`);
}
