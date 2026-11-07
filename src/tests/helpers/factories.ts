import "./env.ts";

import type { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import type { TestOrg } from "./test-org.ts";

type Overrides<T> = Partial<Omit<T, "organizationId">>;

/**
 * Minimal valid rows for one test organization, written straight to the database. They do not go
 * through the posting modules on purpose: those change from phase to phase, this file is the one
 * place to update when a table does. Names and SKUs are numbered, so two calls never collide.
 */
export function factories(t: Pick<TestOrg, "org">) {
  const organizationId = t.org.id;
  let counter = 0;
  const next = () => (counter += 1);

  return {
    product(overrides: Overrides<Prisma.ProductUncheckedCreateInput> = {}) {
      const n = next();
      return prisma.product.create({
        data: {
          organizationId,
          sku: `FACT-${n}`,
          name: `Product ${n}`,
          slug: `product-${n}`,
          purchasePrice: "10.00",
          sellingPrice: "15.00",
          wholesalePrice: "12.00",
          minimumPrice: "11.00",
          trackStock: true,
          trackExpiry: false,
          trackBatch: false,
          trackSerial: false,
          ...overrides,
        },
      });
    },

    customer(overrides: Overrides<Prisma.CustomerUncheckedCreateInput> = {}) {
      const n = next();
      return prisma.customer.create({ data: { organizationId, name: `Customer ${n}`, ...overrides } });
    },

    /** Today the vendor table is `suppliers`. */
    vendor(overrides: Overrides<Prisma.SupplierUncheckedCreateInput> = {}) {
      const n = next();
      return prisma.supplier.create({ data: { organizationId, name: `Vendor ${n}`, ...overrides } });
    },
  };
}
