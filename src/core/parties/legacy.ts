import { Prisma } from "@prisma/client";

import { partyBalances } from "@/core/parties";
import { backfillAllocations } from "@/core/payments/backfill";
import { post } from "@/core/posting/journal";
import { businessDate } from "@/core/time/business-date";

type Db = Prisma.TransactionClient;

// Databases written before P02 kept a customer's or vendor's balance in customer_ledgers / supplier_ledgers and wrote no party
// on the journal lines. The balance now comes from the journal only (I8), so such a database is brought over once, here. Nothing
// is edited except the missing party and document labels on lines and journals that were posted without them; where an advance
// sat on the receivable it is moved to Customer Advance by a new, visible journal; receipts and payments that settled invoices get their
// allocation rows. Safe to run again: it finds nothing left to do.

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => new Prisma.Decimal(String(value ?? 0));
const two = (value: Prisma.Decimal) => value.toFixed(2);

export type RepairResult = { linesStamped: number; journalsDocumented: number; advancesMoved: number; allocationsReplayed: number };

/** The documents whose journal says who a receivable or payable line is about, as (journal, party) rows. */
const customerDocs = Prisma.sql`
  SELECT journalId, customerId FROM sales WHERE journalId IS NOT NULL AND customerId IS NOT NULL
  UNION ALL SELECT journalId, customerId FROM customer_payments WHERE journalId IS NOT NULL
  UNION ALL SELECT journalId, customerId FROM customer_advances WHERE journalId IS NOT NULL
  UNION ALL SELECT sr.journalId, s.customerId FROM sale_returns sr JOIN sales s ON s.id = sr.saleId WHERE sr.journalId IS NOT NULL AND s.customerId IS NOT NULL`;
const supplierDocs = Prisma.sql`
  SELECT journalId, supplierId FROM purchases WHERE journalId IS NOT NULL
  UNION ALL SELECT journalId, supplierId FROM supplier_payments WHERE journalId IS NOT NULL
  UNION ALL SELECT pr.journalId, p.supplierId FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchaseId WHERE pr.journalId IS NOT NULL`;

// journal -> document, for the journals posted before they recorded their document.
const documents: Array<[string, string]> = [
  ["SALE", "SELECT journalId, id FROM sales WHERE journalId IS NOT NULL"],
  ["SALE_RETURN", "SELECT journalId, id FROM sale_returns WHERE journalId IS NOT NULL"],
  ["PURCHASE", "SELECT journalId, id FROM purchases WHERE journalId IS NOT NULL"],
  ["PURCHASE_RETURN", "SELECT journalId, id FROM purchase_returns WHERE journalId IS NOT NULL"],
  ["CUSTOMER_PAYMENT", "SELECT journalId, id FROM customer_payments WHERE journalId IS NOT NULL"],
  ["CUSTOMER_ADVANCE", "SELECT journalId, id FROM customer_advances WHERE journalId IS NOT NULL"],
  ["SUPPLIER_PAYMENT", "SELECT journalId, id FROM supplier_payments WHERE journalId IS NOT NULL"],
  ["EXPENSE", "SELECT journalId, id FROM expenses WHERE journalId IS NOT NULL"],
  ["INCOME", "SELECT journalId, id FROM income WHERE journalId IS NOT NULL"],
  ["CAPITAL", "SELECT journalId, id FROM capital_transactions WHERE journalId IS NOT NULL"],
  ["DIRECT_RETURN", "SELECT journalId, id FROM direct_returns WHERE journalId IS NOT NULL"],
];

async function stampLines(tx: Db, organizationId: string) {
  let total = 0;
  const role = (name: string) => Prisma.sql`JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = ${name}`;
  total += await tx.$executeRaw`
    UPDATE journal_lines l ${role("AR")}
    JOIN (${customerDocs}) d ON d.journalId = l.journalId
    SET l.partyType = 'CUSTOMER', l.partyId = d.customerId
    WHERE l.organizationId = ${organizationId} AND l.partyId IS NULL`;
  total += await tx.$executeRaw`
    UPDATE journal_lines l ${role("AP")}
    JOIN (${supplierDocs}) d ON d.journalId = l.journalId
    SET l.partyType = 'VENDOR', l.partyId = d.supplierId
    WHERE l.organizationId = ${organizationId} AND l.partyId IS NULL`;
  // opening balances had no document: the journal is named after the party, accepted only when the name is unique
  total += await tx.$executeRaw`
    UPDATE journal_lines l ${role("AR")}
    JOIN journals j ON j.id = l.journalId
    JOIN customers c ON c.organizationId = l.organizationId AND j.description = CONCAT('Customer opening ', c.name)
    SET l.partyType = 'CUSTOMER', l.partyId = c.id
    WHERE l.organizationId = ${organizationId} AND l.partyId IS NULL AND l.debit > 0
      AND (SELECT COUNT(*) FROM customers c2 WHERE c2.organizationId = l.organizationId AND c2.name = c.name) = 1`;
  total += await tx.$executeRaw`
    UPDATE journal_lines l ${role("AP")}
    JOIN journals j ON j.id = l.journalId
    JOIN suppliers s ON s.organizationId = l.organizationId AND j.description = CONCAT('Supplier opening ', s.name)
    SET l.partyType = 'VENDOR', l.partyId = s.id
    WHERE l.organizationId = ${organizationId} AND l.partyId IS NULL AND l.credit > 0
      AND (SELECT COUNT(*) FROM suppliers s2 WHERE s2.organizationId = l.organizationId AND s2.name = s.name) = 1`;
  // a loyalty redeem: the old ledger row points at the journal
  total += await tx.$executeRaw`
    UPDATE journal_lines l ${role("AR")}
    JOIN customer_ledgers cl ON cl.organizationId = l.organizationId AND cl.referenceType = 'loyalty' AND cl.referenceId = l.journalId
    SET l.partyType = 'CUSTOMER', l.partyId = cl.customerId
    WHERE l.organizationId = ${organizationId} AND l.partyId IS NULL`;
  return total;
}

async function documentJournals(tx: Db, organizationId: string) {
  let total = 0;
  for (const [type, select] of documents) {
    total += await tx.$executeRaw`
      UPDATE journals j JOIN (${Prisma.raw(select)}) d ON d.journalId = j.id
      SET j.docType = ${type}, j.docId = d.id
      WHERE j.organizationId = ${organizationId} AND j.docType IS NULL AND j.kind = 'POSTING'`;
  }
  // an opening journal was named after its party; accepted only when the name is unique
  total += await tx.$executeRaw`
    UPDATE journals j JOIN customers c ON c.organizationId = j.organizationId AND j.description = CONCAT('Customer opening ', c.name)
    SET j.docType = 'CUSTOMER_OPENING', j.docId = c.id
    WHERE j.organizationId = ${organizationId} AND j.docType IS NULL AND j.kind = 'POSTING'
      AND (SELECT COUNT(*) FROM customers c2 WHERE c2.organizationId = j.organizationId AND c2.name = c.name) = 1`;
  total += await tx.$executeRaw`
    UPDATE journals j JOIN suppliers s ON s.organizationId = j.organizationId AND j.description = CONCAT('Supplier opening ', s.name)
    SET j.docType = 'SUPPLIER_OPENING', j.docId = s.id
    WHERE j.organizationId = ${organizationId} AND j.docType IS NULL AND j.kind = 'POSTING'
      AND (SELECT COUNT(*) FROM suppliers s2 WHERE s2.organizationId = j.organizationId AND s2.name = s.name) = 1`;
  return total;
}

/** A customer whose receivable is negative did not owe: the old model kept their advance there. Move it to Customer Advance. */
async function moveHeldAdvances(tx: Db, input: { organizationId: string; userId: string; branchId: string }) {
  const rows = await tx.$queryRaw<{ partyId: string; net: Prisma.Decimal | string }[]>`
    SELECT l.partyId AS partyId, SUM(l.debit) - SUM(l.credit) AS net
    FROM journal_lines l
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'AR'
    WHERE l.organizationId = ${input.organizationId} AND l.partyType = 'CUSTOMER'
    GROUP BY l.partyId HAVING SUM(l.debit) - SUM(l.credit) < 0`;
  let moved = 0;
  for (const row of rows) {
    const amount = dec(row.net).neg();
    const party = { type: "CUSTOMER" as const, id: row.partyId };
    await post(tx, {
      organizationId: input.organizationId,
      branchId: input.branchId,
      businessDate: new Date(`${businessDate()}T00:00:00.000Z`),
      description: "Advance held for the customer (moved from the receivable)",
      createdById: input.userId,
      doc: { type: "LEGACY_ADVANCE", id: row.partyId },
      lines: [
        { role: "AR", debit: amount, credit: ZERO, party },
        { role: "CUSTOMER_ADVANCE", debit: ZERO, credit: amount, party },
      ],
    });
    moved += 1;
  }
  return moved;
}

/** Brings the party data of an older database over to the journal (see the note at the top). */
export async function repairLegacyParties(db: Db, input: { organizationId: string; userId: string; branchId: string }): Promise<RepairResult> {
  const linesStamped = await stampLines(db, input.organizationId);
  const journalsDocumented = await documentJournals(db, input.organizationId);
  const advancesMoved = await moveHeldAdvances(db, input);
  // Receipts and payments made before allocations existed get the rows the new code would have written (so old invoices show PAID/PARTIAL).
  const allocationsReplayed = await backfillAllocations(db, input.organizationId);
  return { linesStamped, journalsDocumented, advancesMoved, allocationsReplayed };
}

export type PartyMismatch = {
  partyType: "CUSTOMER" | "VENDOR";
  partyId: string;
  name: string;
  /** What the old ledger table says: for a customer receivable minus advance, for a vendor the payable. */
  oldNet: string;
  /** What the journal says: the receivable or payable, and the advance held. */
  journalBalance: string;
  journalAdvance: string;
  difference: string;
};

export type PartyLedgerReport = { checked: { customers: number; suppliers: number }; customers: PartyMismatch[]; suppliers: PartyMismatch[] };

/**
 * For every customer and vendor, the balance in the old ledger table against the balance in the journal. A party whose two
 * balances differ is listed with both numbers. An empty `customers` and `suppliers` means the journal alone says what the old tables said.
 */
export async function comparePartyLedgers(db: Db, organizationId: string): Promise<PartyLedgerReport> {
  const [custOld, suppOld, custJournal, suppJournal] = await Promise.all([
    db.customerLedger.groupBy({ by: ["customerId"], where: { organizationId }, _sum: { debit: true, credit: true } }),
    db.supplierLedger.groupBy({ by: ["supplierId"], where: { organizationId }, _sum: { debit: true, credit: true } }),
    db.$queryRaw<{ partyId: string }[]>`SELECT DISTINCT partyId FROM journal_lines WHERE organizationId = ${organizationId} AND partyType = 'CUSTOMER'`,
    db.$queryRaw<{ partyId: string }[]>`SELECT DISTINCT partyId FROM journal_lines WHERE organizationId = ${organizationId} AND partyType = 'VENDOR'`,
  ]);
  const customerIds = [...new Set([...custOld.map((row) => row.customerId), ...custJournal.map((row) => row.partyId)])];
  const supplierIds = [...new Set([...suppOld.map((row) => row.supplierId), ...suppJournal.map((row) => row.partyId)])];
  const [customerBalances, supplierBalances, customerNames, supplierNames] = await Promise.all([
    partyBalances(db, { organizationId, partyType: "CUSTOMER", partyIds: customerIds }),
    partyBalances(db, { organizationId, partyType: "VENDOR", partyIds: supplierIds }),
    db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }),
    db.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } }),
  ]);
  const customerOld = new Map(custOld.map((row) => [row.customerId, dec(row._sum.debit).minus(dec(row._sum.credit))]));
  const supplierOld = new Map(suppOld.map((row) => [row.supplierId, dec(row._sum.credit).minus(dec(row._sum.debit))]));
  const nameOf = (rows: { id: string; name: string }[]) => new Map(rows.map((row) => [row.id, row.name]));
  const customerName = nameOf(customerNames);
  const supplierName = nameOf(supplierNames);

  const customers: PartyMismatch[] = [];
  for (const id of customerIds) {
    const old = customerOld.get(id) ?? ZERO;
    const journal = customerBalances.get(id) ?? { balance: ZERO, advance: ZERO };
    const mine = journal.balance.minus(journal.advance);
    if (!mine.eq(old)) {
      customers.push({ partyType: "CUSTOMER", partyId: id, name: customerName.get(id) ?? id, oldNet: two(old), journalBalance: two(journal.balance), journalAdvance: two(journal.advance), difference: two(mine.minus(old)) });
    }
  }
  const suppliers: PartyMismatch[] = [];
  for (const id of supplierIds) {
    const old = supplierOld.get(id) ?? ZERO;
    const journal = supplierBalances.get(id) ?? { balance: ZERO, advance: ZERO };
    if (!journal.balance.eq(old)) {
      suppliers.push({ partyType: "VENDOR", partyId: id, name: supplierName.get(id) ?? id, oldNet: two(old), journalBalance: two(journal.balance), journalAdvance: two(journal.advance), difference: two(journal.balance.minus(old)) });
    }
  }
  return { checked: { customers: customerIds.length, suppliers: supplierIds.length }, customers, suppliers };
}
