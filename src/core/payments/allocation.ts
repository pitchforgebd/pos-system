import { Prisma, type PartyType, type PrismaClient } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { parseMoney } from "@/core/money";

// Payment allocation (P02 task 9, invariant I8). A receipt from a customer, or a payment to a vendor, settles invoices or bills:
// each row of payment_allocations says how much of which receipt went to which invoice. A receipt settles the oldest debt first
// (an opening balance, then invoices by date), or the invoices the cashier names; whatever is left over is settled oldest-first.
// What an invoice still owes, and so its PAID / PARTIAL / UNPAID status, is worked out from the books (what the invoice put on the
// customer's account, what a return took off it) and from these rows; nothing is stored on the invoice.

type Db = Prisma.TransactionClient | PrismaClient;

export type PartyKind = "CUSTOMER" | "VENDOR";
export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";

type Config = {
  partyType: PartyType;
  /** The receivable (customers) or payable (vendors) account role the invoices and receipts post to. */
  role: "AR" | "AP";
  /** +1: a charge is a debit (receivable); -1: a charge is a credit (payable). */
  sign: 1 | -1;
  invoiceDoc: "SALE" | "PURCHASE";
  returnDoc: "SALE_RETURN" | "PURCHASE_RETURN";
  openingDoc: "CUSTOMER_OPENING" | "SUPPLIER_OPENING";
  receiptDoc: "CUSTOMER_PAYMENT" | "SUPPLIER_PAYMENT";
  /** What the document is called in a message. */
  noun: "invoice" | "bill";
};

const CONFIG: Record<PartyKind, Config> = {
  CUSTOMER: { partyType: "CUSTOMER", role: "AR", sign: 1, invoiceDoc: "SALE", returnDoc: "SALE_RETURN", openingDoc: "CUSTOMER_OPENING", receiptDoc: "CUSTOMER_PAYMENT", noun: "invoice" },
  VENDOR: { partyType: "VENDOR", role: "AP", sign: -1, invoiceDoc: "PURCHASE", returnDoc: "PURCHASE_RETURN", openingDoc: "SUPPLIER_OPENING", receiptDoc: "SUPPLIER_PAYMENT", noun: "bill" },
};

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => new Prisma.Decimal(String(value ?? 0));
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const CHUNK = 200;

export type DocumentPayment = {
  id: string;
  status: PaymentStatus;
  total: Prisma.Decimal;
  /** What was paid when the document was made (at the till, or with the purchase). */
  paidAtSale: Prisma.Decimal;
  /** What the document put on the party's account and nobody has paid yet, before returns and receipts. */
  due: Prisma.Decimal;
  /** What returns of this document took off the party's account. */
  returned: Prisma.Decimal;
  /** What receipts or payments have settled, by payment_allocations. */
  allocated: Prisma.Decimal;
  /** What is still owed on it. */
  owed: Prisma.Decimal;
};

type Doc = { id: string; total: Prisma.Decimal };

function table(kind: PartyKind) {
  return kind === "CUSTOMER" ? { column: "invoiceId" as const } : { column: "billId" as const };
}

type Net = { docId: string; net: Prisma.Decimal | string | null };

/**
 * A purchase's journal can owe money to two parties: the vendor (the bill) and the carrier (the haulage, when it is on credit, P05). Only
 * the vendor's payable lines are the bill; the carrier's are a debt of their own, settled by payments to the carrier.
 */
function billOwnLines(docType: string) {
  return docType === "PURCHASE" ? Prisma.sql`AND l.partyId = (SELECT b.supplierId FROM purchases b WHERE b.id = j.docId)` : Prisma.empty;
}

/** The net debit (debit - credit) of the party-account lines of each document of a type, by document id. */
async function netByDocument(db: Db, organizationId: string, cfg: Config, docType: string, docIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  const result = new Map<string, Prisma.Decimal>();
  if (docIds.length === 0) {
    return result;
  }
  const rows = await db.$queryRaw<Net[]>`
    SELECT j.docId AS docId, SUM(l.debit - l.credit) AS net
    FROM journals j
    JOIN journal_lines l ON l.journalId = j.id
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = ${cfg.role}
    WHERE j.organizationId = ${organizationId} AND j.docType = ${docType} AND j.docId IN (${Prisma.join(docIds)}) ${billOwnLines(docType)}
    GROUP BY j.docId
  `;
  for (const row of rows) {
    result.set(row.docId, dec(row.net));
  }
  return result;
}

/** How much of each invoice or bill is paid, returned and owed. Every asked document has an entry. */
async function figures(db: Db, organizationId: string, kind: PartyKind, docs: Doc[]): Promise<Map<string, DocumentPayment>> {
  const cfg = CONFIG[kind];
  const ids = docs.map((doc) => doc.id);
  const result = new Map<string, DocumentPayment>();
  if (ids.length === 0) {
    return result;
  }
  const charges = await netByDocument(db, organizationId, cfg, cfg.invoiceDoc, ids);

  // Returns of these documents: the return's own id is the journal's document id.
  const returns =
    kind === "CUSTOMER"
      ? (await db.saleReturn.findMany({ where: { organizationId, saleId: { in: ids } }, select: { id: true, saleId: true } })).map((row) => ({ id: row.id, documentId: row.saleId }))
      : (await db.purchaseReturn.findMany({ where: { organizationId, purchaseId: { in: ids } }, select: { id: true, purchaseId: true } })).map((row) => ({ id: row.id, documentId: row.purchaseId }));
  const returnNet = await netByDocument(db, organizationId, cfg, cfg.returnDoc, returns.map((row) => row.id));
  const returned = new Map<string, Prisma.Decimal>();
  for (const row of returns) {
    // A return lowers the balance: a credit on a receivable, a debit on a payable.
    const value = (returnNet.get(row.id) ?? ZERO).mul(-cfg.sign);
    returned.set(row.documentId, (returned.get(row.documentId) ?? ZERO).plus(value));
  }

  const column = table(kind).column;
  const grouped = await db.paymentAllocation.groupBy({ by: [column], where: { organizationId, [column]: { in: ids } }, _sum: { amount: true } });
  const allocated = new Map<string, Prisma.Decimal>(grouped.map((row) => [String(row[column]), dec(row._sum.amount)]));

  // Paid with the purchase itself (its own payment row), which the AP credit of the purchase still includes.
  const upfront = new Map<string, Prisma.Decimal>();
  if (kind === "VENDOR") {
    const paid = await db.purchasePayment.groupBy({ by: ["purchaseId"], where: { organizationId, purchaseId: { in: ids } }, _sum: { amount: true } });
    for (const row of paid) {
      upfront.set(row.purchaseId, dec(row._sum.amount));
    }
  }

  for (const doc of docs) {
    const charged = (charges.get(doc.id) ?? ZERO).mul(cfg.sign);
    const paidUpfront = upfront.get(doc.id) ?? ZERO;
    // A sale's receivable already leaves out what was paid at the till; a purchase's payable still includes what was paid with it.
    const due = kind === "CUSTOMER" ? charged : charged.minus(paidUpfront);
    const paidAtSale = kind === "CUSTOMER" ? doc.total.minus(charged) : paidUpfront;
    const back = returned.get(doc.id) ?? ZERO;
    const settled = allocated.get(doc.id) ?? ZERO;
    const raw = due.minus(back).minus(settled);
    const owed = money(raw.gt(0) ? raw : ZERO);
    const anyPaid = paidAtSale.plus(settled).gt(0);
    result.set(doc.id, {
      id: doc.id,
      status: owed.eq(0) ? "PAID" : anyPaid ? "PARTIAL" : "UNPAID",
      total: doc.total,
      paidAtSale: money(paidAtSale),
      due: money(due),
      returned: money(back),
      allocated: money(settled),
      owed,
    });
  }
  return result;
}

async function oneDocument(db: Db, organizationId: string, kind: PartyKind, id: string): Promise<DocumentPayment> {
  const doc =
    kind === "CUSTOMER"
      ? await db.sale.findFirst({ where: { id, organizationId }, select: { id: true, total: true } })
      : await db.purchase.findFirst({ where: { id, organizationId }, select: { id: true, total: true } });
  if (!doc) {
    throw new RuleError("That record was not found.", 404);
  }
  const found = await figures(db, organizationId, kind, [{ id: doc.id, total: dec(doc.total) }]);
  return found.get(doc.id) as DocumentPayment;
}

/** What is paid and owed on one sale (invoice), and its status. */
export function invoicePayment(db: Db, organizationId: string, saleId: string): Promise<DocumentPayment> {
  return oneDocument(db, organizationId, "CUSTOMER", saleId);
}

/** What is paid and owed on one purchase (bill), and its status. */
export function billPayment(db: Db, organizationId: string, purchaseId: string): Promise<DocumentPayment> {
  return oneDocument(db, organizationId, "VENDOR", purchaseId);
}

/** Payment status of several documents at once (for a list). */
export async function paymentStatuses(db: Db, organizationId: string, kind: PartyKind, docs: Doc[]): Promise<Map<string, DocumentPayment>> {
  return figures(db, organizationId, kind, docs);
}

type Named = { documentId: string; amount: string };

export type AllocationRow = { documentId: string; amount: Prisma.Decimal };

/**
 * What of an opening balance is still unpaid: the opening charged to the party, less the receipts that did not go to an invoice
 * (an opening balance is the oldest debt, so those went to it). Payments made together with a purchase are not receipts. `ignore`
 * are journals left out: the receipt being allocated, which is already posted, and any later receipt not yet allocated.
 */
async function openingOpen(db: Db, organizationId: string, kind: PartyKind, partyId: string, ignore: string[]): Promise<Prisma.Decimal> {
  const cfg = CONFIG[kind];
  const rows = await db.$queryRaw<Array<{ docType: string; net: Prisma.Decimal | string | null }>>`
    SELECT j.docType AS docType, SUM(l.debit - l.credit) AS net
    FROM journals j
    JOIN journal_lines l ON l.journalId = j.id
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = ${cfg.role}
    WHERE l.organizationId = ${organizationId} AND l.partyType = ${cfg.partyType} AND l.partyId = ${partyId}
      AND j.docType IN (${cfg.openingDoc}, ${cfg.receiptDoc}) AND j.id NOT IN (${Prisma.join(ignore)})
    GROUP BY j.docType
  `;
  let opening = ZERO;
  let receipts = ZERO;
  for (const row of rows) {
    const value = dec(row.net).mul(cfg.sign);
    if (row.docType === cfg.openingDoc) {
      opening = value;
    } else {
      receipts = value.neg();
    }
  }
  if (opening.lte(0)) {
    return ZERO;
  }
  const allocated = await db.$queryRaw<Array<{ amount: Prisma.Decimal | string | null }>>`
    SELECT SUM(a.amount) AS amount
    FROM payment_allocations a
    WHERE a.organizationId = ${organizationId}
      AND a.journalId IN (
        SELECT l.journalId FROM journal_lines l JOIN journals j ON j.id = l.journalId
        WHERE l.organizationId = ${organizationId} AND l.partyType = ${cfg.partyType} AND l.partyId = ${partyId} AND j.docType = ${cfg.receiptDoc}
          AND j.id NOT IN (${Prisma.join(ignore)})
      )
  `;
  let toOpening = receipts.minus(dec(allocated[0]?.amount));
  if (kind === "VENDOR") {
    const upfront = await db.purchasePayment.aggregate({ where: { organizationId, purchase: { supplierId: partyId } }, _sum: { amount: true } });
    toOpening = toOpening.minus(dec(upfront._sum.amount));
  }
  const open = opening.minus(toOpening.gt(0) ? toOpening : ZERO);
  return money(open.gt(0) ? open : ZERO);
}

/** The party's invoices or bills, oldest first, a chunk at a time. */
async function documentsOldestFirst(db: Db, organizationId: string, kind: PartyKind, partyId: string, skip: number, upTo?: Date): Promise<Doc[]> {
  const orderBy = [{ businessDate: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];
  const date = upTo ? { businessDate: { lte: upTo } } : {};
  const rows =
    kind === "CUSTOMER"
      ? await db.sale.findMany({ where: { organizationId, customerId: partyId, status: "POSTED", ...date }, orderBy, skip, take: CHUNK, select: { id: true, total: true } })
      : await db.purchase.findMany({ where: { organizationId, supplierId: partyId, status: "RECEIVED", ...date }, orderBy, skip, take: CHUNK, select: { id: true, total: true } });
  return rows.map((row) => ({ id: row.id, total: dec(row.total) }));
}

/**
 * Settle invoices or bills with one receipt or payment. The caller has locked the party's row, posted the journal and checked the
 * amount against the balance. `named` are the invoices the cashier chose; what they do not cover goes to the oldest debt.
 * Returns the rows written. Refuses (422) a named document that is not the party's, an amount above what is owed on it, or named
 * amounts above the receipt.
 */
export async function allocatePayment(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; kind: PartyKind; partyId: string; journalId: string; amount: Prisma.Decimal; named?: Named[]; upTo?: Date; ignore?: string[] },
): Promise<AllocationRow[]> {
  const cfg = CONFIG[input.kind];
  const given = new Map<string, Prisma.Decimal>();
  for (const entry of input.named ?? []) {
    const value = parseMoney(entry.amount);
    if (!value || value.lte(0)) {
      throw new RuleError(`Enter an amount greater than zero for each ${cfg.noun}.`);
    }
    if (given.has(entry.documentId)) {
      throw new RuleError(`The ${cfg.noun} is listed twice.`);
    }
    given.set(entry.documentId, value);
  }
  const namedTotal = [...given.values()].reduce((sum, value) => sum.plus(value), ZERO);
  if (namedTotal.gt(input.amount)) {
    throw new RuleError("The amounts given to invoices are more than the payment.");
  }

  const taken = new Map<string, Prisma.Decimal>();
  if (given.size > 0) {
    const ids = [...given.keys()];
    const own =
      input.kind === "CUSTOMER"
        ? await tx.sale.findMany({ where: { id: { in: ids }, organizationId: input.organizationId, customerId: input.partyId, status: "POSTED" }, select: { id: true, total: true } })
        : await tx.purchase.findMany({ where: { id: { in: ids }, organizationId: input.organizationId, supplierId: input.partyId, status: "RECEIVED" }, select: { id: true, total: true } });
    if (own.length !== ids.length) {
      throw new RuleError(`That ${cfg.noun} is not one of this ${input.kind === "CUSTOMER" ? "customer" : "supplier"}'s.`);
    }
    const now = await figures(tx, input.organizationId, input.kind, own.map((row) => ({ id: row.id, total: dec(row.total) })));
    for (const [id, value] of given) {
      if (value.gt(now.get(id)?.owed ?? ZERO)) {
        throw new RuleError(`That is more than what is owed on the ${cfg.noun}.`);
      }
      taken.set(id, value);
    }
  }

  let remaining = input.amount.minus(namedTotal);
  if (remaining.gt(0)) {
    remaining = remaining.minus(Prisma.Decimal.min(remaining, await openingOpen(tx, input.organizationId, input.kind, input.partyId, [input.journalId, ...(input.ignore ?? [])])));
  }
  for (let skip = 0; remaining.gt(0); skip += CHUNK) {
    const docs = await documentsOldestFirst(tx, input.organizationId, input.kind, input.partyId, skip, input.upTo);
    if (docs.length === 0) {
      break;
    }
    const now = await figures(tx, input.organizationId, input.kind, docs);
    for (const doc of docs) {
      const open = (now.get(doc.id)?.owed ?? ZERO).minus(taken.get(doc.id) ?? ZERO);
      if (open.lte(0) || remaining.lte(0)) {
        continue;
      }
      const part = Prisma.Decimal.min(open, remaining);
      taken.set(doc.id, (taken.get(doc.id) ?? ZERO).plus(part));
      remaining = remaining.minus(part);
    }
    if (docs.length < CHUNK) {
      break;
    }
  }

  const column = table(input.kind).column;
  const rows: AllocationRow[] = [];
  for (const [documentId, value] of taken) {
    await tx.paymentAllocation.create({ data: { organizationId: input.organizationId, journalId: input.journalId, [column]: documentId, amount: money(value) } });
    rows.push({ documentId, amount: money(value) });
  }
  return rows;
}

export type AllocationViolation = { id: string; problem: string };

type Over = { id: string; allocated: Prisma.Decimal | string; limit: Prisma.Decimal | string };

/**
 * I8: no invoice or bill is settled for more than it put on the books, no receipt or payment settles more than it was, and a
 * receipt only settles its own party's invoices. Returns what is wrong, or an empty list.
 */
export async function allocationViolations(db: Db, organizationId: string): Promise<AllocationViolation[]> {
  const found: AllocationViolation[] = [];
  for (const kind of ["CUSTOMER", "VENDOR"] as const) {
    const cfg = CONFIG[kind];
    const column = table(kind).column;
    const over = await db.$queryRaw<Over[]>`
      SELECT a.${Prisma.raw(column)} AS id, SUM(a.amount) AS allocated, COALESCE(c.charged, 0) AS \`limit\`
      FROM payment_allocations a
      LEFT JOIN (
        SELECT j.docId AS docId, SUM(l.debit - l.credit) * ${cfg.sign} AS charged
        FROM journals j
        JOIN journal_lines l ON l.journalId = j.id
        JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = ${cfg.role}
        WHERE j.organizationId = ${organizationId} AND j.docType = ${cfg.invoiceDoc} ${billOwnLines(cfg.invoiceDoc)}
        GROUP BY j.docId
      ) c ON c.docId = a.${Prisma.raw(column)}
      WHERE a.organizationId = ${organizationId} AND a.${Prisma.raw(column)} IS NOT NULL
      GROUP BY a.${Prisma.raw(column)}, c.charged
      HAVING SUM(a.amount) > COALESCE(c.charged, 0)
    `;
    for (const row of over) {
      found.push({ id: row.id, problem: `${cfg.noun} ${row.id}: ${dec(row.allocated).toFixed(2)} was settled, but it only put ${dec(row.limit).toFixed(2)} on the account` });
    }
  }
  const receipts = await db.$queryRaw<Array<Over & { docType: string }>>`
    SELECT a.journalId AS id, j.docType AS docType, SUM(a.amount) AS allocated, COALESCE(p.posted, 0) AS \`limit\`
    FROM payment_allocations a
    JOIN journals j ON j.id = a.journalId
    LEFT JOIN (
      SELECT l.journalId AS journalId, ABS(SUM(l.debit - l.credit)) AS posted
      FROM journal_lines l
      JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role IN ('AR', 'AP')
      WHERE l.organizationId = ${organizationId}
        AND l.journalId IN (SELECT journalId FROM payment_allocations WHERE organizationId = ${organizationId})
      GROUP BY l.journalId
    ) p ON p.journalId = a.journalId
    WHERE a.organizationId = ${organizationId}
    GROUP BY a.journalId, j.docType, p.posted
    HAVING SUM(a.amount) > COALESCE(p.posted, 0)
  `;
  for (const row of receipts) {
    const noun = row.docType === "SUPPLIER_PAYMENT" ? "payment" : "receipt";
    found.push({ id: row.id, problem: `${noun} ${row.id}: it settled ${dec(row.allocated).toFixed(2)}, but it was only ${dec(row.limit).toFixed(2)}` });
  }
  const strangers = await db.$queryRaw<Array<{ id: string }>>`
    SELECT a.id AS id
    FROM payment_allocations a
    JOIN journal_lines l ON l.journalId = a.journalId AND l.partyId IS NOT NULL AND l.partyType IN ('CUSTOMER', 'VENDOR')
    LEFT JOIN sales s ON s.id = a.invoiceId
    LEFT JOIN purchases p ON p.id = a.billId
    WHERE a.organizationId = ${organizationId}
      AND ((a.invoiceId IS NOT NULL AND (s.id IS NULL OR s.customerId IS NULL OR s.customerId <> l.partyId))
        OR (a.billId IS NOT NULL AND (p.id IS NULL OR p.supplierId <> l.partyId)))
  `;
  for (const row of strangers) {
    found.push({ id: row.id, problem: `allocation ${row.id}: a receipt or payment settles another party's document` });
  }
  return found;
}
