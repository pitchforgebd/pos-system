import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { post } from "@/core/posting/journal";
import { businessDate } from "@/core/time/business-date";

// Before P03 the stock documents (opening, own stock, adjustment, damage, transfer) moved stock and wrote no journal, so a database
// that held stock then has stock the books never carried: the inventory account (GL 1400 in the default chart) is below the stock
// value, or even negative once sales credited it. This brings the two together once, with one visible journal per branch:
// "v2 opening adjustment", Dr Inventory / Cr Opening Balance Equity (or the other way when the books hold more than the stock).
// Stock that never had a cost is first given its product's purchase price as its average cost: the books must carry some value, and
// that is the best one known. Nothing is edited; running it again finds the difference already closed.

type Db = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => new Prisma.Decimal(String(value ?? 0));

export type StockBooksResult = { branches: number; priced: number };

export async function adjustLegacyStockBooks(tx: Db, input: { organizationId: string; userId: string }): Promise<StockBooksResult> {
  const priced = await tx.$executeRaw`
    UPDATE stock_balances sb JOIN products p ON p.id = sb.productId
    SET sb.averageCost = p.purchasePrice
    WHERE sb.organizationId = ${input.organizationId} AND sb.averageCost IS NULL AND sb.quantity > 0`;

  const stock = await tx.$queryRaw<Array<{ branchId: string; value: Prisma.Decimal | null }>>`
    SELECT branchId, SUM(ROUND(quantity * COALESCE(averageCost, 0), 2)) AS value
    FROM stock_balances WHERE organizationId = ${input.organizationId} GROUP BY branchId`;
  const books = await tx.$queryRaw<Array<{ branchId: string | null; value: Prisma.Decimal | null }>>`
    SELECT l.branchId AS branchId, SUM(l.debit - l.credit) AS value
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'INVENTORY'
    WHERE l.organizationId = ${input.organizationId} GROUP BY l.branchId`;
  const gap = new Map<string, Prisma.Decimal>();
  for (const row of stock) {
    gap.set(row.branchId, dec(row.value));
  }
  for (const row of books) {
    if (row.branchId) {
      gap.set(row.branchId, (gap.get(row.branchId) ?? ZERO).minus(dec(row.value)));
    }
  }

  let adjusted = 0;
  for (const [branchId, difference] of [...gap].sort(([a], [b]) => a.localeCompare(b))) {
    const amount = difference.abs().toDecimalPlaces(2);
    if (amount.lt("0.01")) {
      continue;
    }
    const up = difference.gt(0);
    await post(tx, {
      organizationId: input.organizationId,
      branchId,
      businessDate: new Date(`${businessDate()}T00:00:00.000Z`),
      description: "v2 opening adjustment: the inventory account brought to the stock on hand at its average cost",
      createdById: input.userId,
      doc: { type: "STOCK_BOOKS_ADJUSTMENT", id: randomUUID() },
      lines: up
        ? [{ role: "INVENTORY", debit: amount, credit: ZERO }, { role: "OPENING_EQUITY", debit: ZERO, credit: amount }]
        : [{ role: "OPENING_EQUITY", debit: amount, credit: ZERO }, { role: "INVENTORY", debit: ZERO, credit: amount }],
    });
    adjusted += 1;
  }
  return { branches: adjusted, priced };
}
