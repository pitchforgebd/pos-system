import { Prisma } from "@prisma/client";

import { StockRuleError } from "@/core/stock/engine";

// IMEI and serial numbers (P03 task 7, N4, L8, I13). A serial is added when the stock comes in (a purchase, an opening, own stock):
// one for each unit, in the warehouse the stock arrives in, pointing at the ledger row that brought it. A sale takes it with one
// conditional update (still in stock, in the warehouse it sells from), so two sales of the same unit cannot both win.

type Db = Prisma.TransactionClient;

/** Cleans a list of serials: trimmed, none empty, none twice. */
export function cleanSerials(serials: string[] | undefined): string[] {
  const cleaned = (serials ?? []).map((value) => value.trim());
  if (cleaned.some((value) => value === "" || value.length > 64)) {
    throw new StockRuleError("An IMEI or serial is 1 to 64 characters.");
  }
  if (new Set(cleaned).size !== cleaned.length) {
    throw new StockRuleError("The same IMEI or serial is listed twice.");
  }
  return cleaned;
}

/** A serial-tracked product comes in a whole unit at a time, with exactly one serial for each unit. */
export function requireSerialPerUnit(quantity: Prisma.Decimal, serials: string[]) {
  if (!quantity.isInteger() || !quantity.eq(serials.length)) {
    throw new StockRuleError("Enter one IMEI or serial for each unit, and bring in whole units.");
  }
}

/** Adds the serials of stock that just came in. Refuses a serial that already exists. */
export async function addSerials(
  tx: Db,
  input: { organizationId: string; productId: string; variantId?: string | null; warehouseId: string; serials: string[]; inMovementId: string },
) {
  for (const serial of input.serials) {
    try {
      await tx.productSerial.create({
        data: {
          organizationId: input.organizationId,
          productId: input.productId,
          variantId: input.variantId ?? null,
          warehouseId: input.warehouseId,
          serial,
          status: "IN_STOCK",
          inMovementId: input.inMovementId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new StockRuleError(`The IMEI or serial ${serial} already exists.`);
      }
      throw error;
    }
  }
}

/**
 * A sale takes one serial: still in stock, of that product, and in the warehouse the sale is from (a serial with no warehouse is
 * older data and goes with any). One conditional update; it must change exactly one row.
 */
export async function sellSerial(tx: Db, input: { organizationId: string; productId: string; warehouseId: string; serial: string; saleId: string }) {
  const taken = await tx.productSerial.updateMany({
    where: {
      organizationId: input.organizationId,
      productId: input.productId,
      serial: input.serial,
      status: "IN_STOCK",
      OR: [{ warehouseId: input.warehouseId }, { warehouseId: null }],
    },
    data: { status: "SOLD", saleId: input.saleId },
  });
  if (taken.count !== 1) {
    throw new StockRuleError("That IMEI is not in stock for this product here.");
  }
}
