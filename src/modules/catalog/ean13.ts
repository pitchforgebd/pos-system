import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import { ean13CheckDigit, isValidEan13 } from "@/modules/catalog/barcode-art";

export { barcodeBars, CODE39, ean13CheckDigit, isValidEan13 } from "@/modules/catalog/barcode-art";
export type { Bars } from "@/modules/catalog/barcode-art";

// The shop's own EAN-13 numbers. The 200-299 range of EAN-13 is set aside for a shop's internal use, so a code made here never meets a
// manufacturer's.

type Failure = { ok: false; status: 404 | 409 | 422; message: string };

const PREFIX = "200";

/**
 * Adds a new EAN-13 of the shop's own to a product (or a variant): 200, a nine-digit number one above the last one made, a check digit.
 * Two of them made at the same moment both end up with a number of their own: a clash on the unique key is retried from the new last one.
 */
export async function generateBarcode(input: { organizationId: string; productId: string; variantId?: string | null }): Promise<{ ok: true; barcode: { id: string; barcode: string } } | Failure> {
  const product = await prisma.product.findFirst({ where: { id: input.productId, organizationId: input.organizationId, deletedAt: null }, select: { id: true } });
  if (!product) {
    return { ok: false, status: 404, message: "That record was not found." };
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const recent = await prisma.productBarcode.findMany({
      where: { organizationId: input.organizationId, barcode: { gte: `${PREFIX}0000000000`, lte: `${PREFIX}9999999999` } },
      orderBy: { barcode: "desc" },
      take: 5,
      select: { barcode: true },
    });
    const last = recent.find((row) => isValidEan13(row.barcode))?.barcode;
    const next = last ? Number(last.slice(3, 12)) + 1 : 1;
    if (next > 999_999_999) {
      return { ok: false, status: 422, message: "The shop's own barcode numbers are used up." };
    }
    const body = `${PREFIX}${String(next).padStart(9, "0")}`;
    const barcode = `${body}${ean13CheckDigit(body)}`;
    try {
      const row = await prisma.productBarcode.create({
        data: { organizationId: input.organizationId, productId: product.id, variantId: input.variantId ?? null, barcode },
        select: { id: true, barcode: true },
      });
      return { ok: true, barcode: row };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 20)));
    }
  }
  return { ok: false, status: 409, message: "Could not make a barcode just now. Try again." };
}
