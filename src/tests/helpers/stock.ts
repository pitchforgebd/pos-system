import "./env.ts";

import { Prisma } from "@prisma/client";

import { post } from "../../core/posting/journal.ts";
import { businessDate } from "../../core/time/business-date.ts";
import { runTx } from "../../core/tx/run.ts";
import { prisma } from "../../lib/db/client.ts";
import type { TestOrg } from "./test-org.ts";

type Overrides = Partial<Omit<Prisma.ProductUncheckedCreateInput, "organizationId">>;

/**
 * A product with stock on hand that the books agree with: the stock balance, its ledger row, and the opening journal
 * (Dr Inventory / Cr Opening Balance Equity) all say `units` at `cost`. A test that sells or buys from here ends with books that
 * `assertBooksReconcile` accepts, stock and inventory account included.
 */
export async function stockedProduct(
  t: Pick<TestOrg, "org" | "branch" | "warehouse" | "owner">,
  input: { units?: number; cost?: string; price?: string; product?: Overrides } = {},
) {
  const units = input.units ?? 1000;
  const cost = input.cost ?? "6.00";
  const price = input.price ?? "10.00";
  const n = Math.random().toString(36).slice(2, 10);
  const product = await prisma.product.create({
    data: {
      organizationId: t.org.id,
      sku: `STK-${n}`,
      name: `Stocked ${n}`,
      slug: `stocked-${n}`,
      purchasePrice: cost,
      sellingPrice: price,
      wholesalePrice: price,
      minimumPrice: "1.00",
      trackStock: true,
      trackExpiry: false,
      trackBatch: false,
      trackSerial: false,
      ...input.product,
    },
  });
  await prisma.stockBalance.create({
    data: { organizationId: t.org.id, productId: product.id, branchId: t.branch.id, warehouseId: t.warehouse.id, quantity: String(units), averageCost: cost },
  });
  await prisma.stockLedger.create({
    data: {
      organizationId: t.org.id,
      productId: product.id,
      branchId: t.branch.id,
      warehouseId: t.warehouse.id,
      quantity: String(units),
      direction: "IN",
      movementType: "OPENING",
      referenceType: "test",
      referenceId: product.id,
      unitCost: cost,
      userId: t.owner.id,
    },
  });
  const value = new Prisma.Decimal(cost).mul(units).toDecimalPlaces(2);
  if (value.gt(0)) {
    await runTx((tx) =>
      post(tx, {
        organizationId: t.org.id,
        branchId: t.branch.id,
        businessDate: new Date(`${businessDate()}T00:00:00.000Z`),
        description: `Opening stock ${product.sku}`,
        createdById: t.owner.id,
        doc: { type: "JOURNAL", id: product.id },
        lines: [
          { role: "INVENTORY", debit: value, credit: new Prisma.Decimal(0) },
          { role: "OPENING_EQUITY", debit: new Prisma.Decimal(0), credit: value },
        ],
      }),
    );
  }
  return product;
}
