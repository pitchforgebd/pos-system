import { Prisma } from "@prisma/client";

import { allocatePayment, type PartyKind } from "@/core/payments/allocation";

// A database written before P02 has receipts and payments with no allocation rows, so every old invoice would read UNPAID. This
// replays them, oldest first, through the same allocation the new code uses, and writes the rows it would have written. A receipt
// can only settle invoices dated on or before it. Receipts that already have rows are left alone, so it is safe to run again;
// it is meant for a database that was written by the old code, run once by the party repair.

type Receipt = { journalId: string; partyId: string; businessDate: Date; amount: Prisma.Decimal | string | null };

async function unallocatedReceipts(tx: Prisma.TransactionClient, organizationId: string, kind: PartyKind): Promise<Receipt[]> {
  if (kind === "CUSTOMER") {
    return tx.$queryRaw<Receipt[]>`
      SELECT j.id AS journalId, l.partyId AS partyId, j.businessDate AS businessDate, SUM(l.credit - l.debit) AS amount
      FROM journals j
      JOIN journal_lines l ON l.journalId = j.id
      JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'AR'
      WHERE j.organizationId = ${organizationId} AND j.docType = 'CUSTOMER_PAYMENT' AND j.kind = 'POSTING' AND l.partyType = 'CUSTOMER'
        AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.journalId = j.id)
      GROUP BY j.id, l.partyId, j.businessDate, j.createdAt
      ORDER BY j.businessDate, j.createdAt, j.id
    `;
  }
  // A payment made together with a purchase is part of that purchase (its own purchase_payments row), not a payment on account:
  // it is recognised by the payment row of the same supplier, amount and method written in the same moment.
  return tx.$queryRaw<Receipt[]>`
    SELECT j.id AS journalId, l.partyId AS partyId, j.businessDate AS businessDate, SUM(l.debit - l.credit) AS amount
    FROM journals j
    JOIN journal_lines l ON l.journalId = j.id
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'AP'
    WHERE j.organizationId = ${organizationId} AND j.docType = 'SUPPLIER_PAYMENT' AND j.kind = 'POSTING' AND l.partyType = 'VENDOR'
      AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.journalId = j.id)
      AND NOT EXISTS (
        SELECT 1 FROM supplier_payments sp
        JOIN purchase_payments pp ON pp.organizationId = sp.organizationId AND pp.amount = sp.amount AND pp.method = sp.method
        JOIN purchases pu ON pu.id = pp.purchaseId AND pu.supplierId = sp.supplierId
        WHERE sp.journalId = j.id AND ABS(TIMESTAMPDIFF(SECOND, pp.createdAt, sp.createdAt)) <= 5
      )
    GROUP BY j.id, l.partyId, j.businessDate, j.createdAt
    ORDER BY j.businessDate, j.createdAt, j.id
  `;
}

/** Writes the allocation rows that receipts and payments made before they existed would have had. Returns how many it replayed. */
export async function backfillAllocations(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  let replayed = 0;
  for (const kind of ["CUSTOMER", "VENDOR"] as const) {
    const receipts = await unallocatedReceipts(tx, organizationId, kind);
    for (const [index, receipt] of receipts.entries()) {
      const amount = new Prisma.Decimal(String(receipt.amount ?? 0));
      if (amount.lte(0)) {
        continue;
      }
      // The same party's later receipts have not been replayed yet, so they must not count as already paid.
      const later = receipts.slice(index + 1).filter((other) => other.partyId === receipt.partyId).map((other) => other.journalId);
      await allocatePayment(tx, {
        organizationId,
        kind,
        partyId: receipt.partyId,
        journalId: receipt.journalId,
        amount,
        upTo: receipt.businessDate,
        ignore: later,
      });
      replayed += 1;
    }
  }
  return replayed;
}
