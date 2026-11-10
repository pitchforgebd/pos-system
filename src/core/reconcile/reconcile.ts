import { Prisma, type PrismaClient } from "@prisma/client";

import { GROUP } from "@/core/ledger/groups";
import { allocationViolations } from "@/core/payments";
import { partyLineViolations } from "@/core/posting/invariants";
import { prisma } from "@/lib/db/client";

// P02 task 10. The books must agree with themselves and with the stock. assertBooksReconcile runs at the end of every integration
// test and in the daily job; when something is off it says which journal, account, product or party, and by how much, so the cause
// can be found without a search. It checks:
//   I1  every posted journal balances, and every line is a debit or a credit, never both or neither
//   I2  receivable, payable, advance and courier lines name their party, and no other line does
//   I4  stock on hand = the sum of the stock movements, for each product, branch and warehouse
//   I6  the inventory account of a branch = stock on hand x average cost (within 1.00). Only a warning for now: it becomes a hard
//       check when stock valuation is complete (P03)
//   I7  the quantity in expiry lots of a warehouse does not exceed the stock on hand in that warehouse
//   I8  no invoice or bill is settled for more than it put on the books, no receipt settles more than it was
//   I15 the trial balance balances, and assets = liabilities + equity + profit so far

type Db = Prisma.TransactionClient | PrismaClient;

export type Finding = { invariant: "I1" | "I2" | "I4" | "I6" | "I7" | "I8" | "I15"; subject: string; message: string };
export type ReconcileResult = { findings: Finding[]; warnings: Finding[] };

const dec = (value: unknown) => new Prisma.Decimal(String(value ?? 0));
const ZERO = new Prisma.Decimal(0);
/** Inventory account against stock value: a difference up to this is rounding. */
const INVENTORY_TOLERANCE = new Prisma.Decimal("1.00");

export class BooksReconcileError extends Error {
  readonly findings: Finding[];
  readonly warnings: Finding[];

  constructor(findings: Finding[], warnings: Finding[]) {
    super(`The books do not reconcile:\n${[...findings, ...warnings].map((f) => `  ${f.invariant} ${f.subject}: ${f.message}`).join("\n")}`);
    this.name = "BooksReconcileError";
    this.findings = findings;
    this.warnings = warnings;
  }
}

async function journalsThatDoNotBalance(db: Db, organizationId: string): Promise<Finding[]> {
  const rows = await db.$queryRaw<Array<{ id: string; number: string | null; debit: Prisma.Decimal | string; credit: Prisma.Decimal | string }>>`
    SELECT j.id AS id, j.number AS number, SUM(l.debit) AS debit, SUM(l.credit) AS credit
    FROM journals j JOIN journal_lines l ON l.journalId = j.id
    WHERE j.organizationId = ${organizationId} AND j.status = 'POSTED'
    GROUP BY j.id, j.number
    HAVING SUM(l.debit) <> SUM(l.credit)
    ORDER BY j.id
  `;
  const found: Finding[] = rows.map((row) => ({
    invariant: "I1",
    subject: `journal ${row.number ? `${row.number} ` : ""}${row.id}`,
    message: `debit ${dec(row.debit).toFixed(2)}, credit ${dec(row.credit).toFixed(2)}, difference ${dec(row.debit).minus(dec(row.credit)).toFixed(2)}`,
  }));
  const lines = await db.$queryRaw<Array<{ id: string; journalId: string }>>`
    SELECT id, journalId FROM journal_lines
    WHERE organizationId = ${organizationId} AND NOT ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
    ORDER BY id
  `;
  for (const line of lines) {
    found.push({ invariant: "I1", subject: `line ${line.id} of journal ${line.journalId}`, message: "a line must be a debit or a credit above zero, not both and not neither" });
  }
  return found;
}

async function trialBalanceFindings(db: Db, organizationId: string): Promise<Finding[]> {
  const groups = await db.$queryRaw<Array<{ code: string; debit: Prisma.Decimal | string | null; credit: Prisma.Decimal | string | null }>>`
    SELECT g.code AS code, SUM(l.debit) AS debit, SUM(l.credit) AS credit
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN accounts a ON a.id = l.accountId
    JOIN account_groups g ON g.id = a.groupId
    WHERE l.organizationId = ${organizationId}
    GROUP BY g.code
  `;
  let debit = ZERO;
  let credit = ZERO;
  const net = new Map<string, Prisma.Decimal>();
  for (const row of groups) {
    debit = debit.plus(dec(row.debit));
    credit = credit.plus(dec(row.credit));
    net.set(row.code, dec(row.debit).minus(dec(row.credit)));
  }
  if (!debit.eq(credit)) {
    return [{ invariant: "I15", subject: "trial balance", message: `debits ${debit.toFixed(2)}, credits ${credit.toFixed(2)}, difference ${debit.minus(credit).toFixed(2)}` }];
  }
  const known: string[] = Object.values(GROUP);
  const stray = [...net].filter(([code, value]) => !known.includes(code) && !value.eq(0));
  if (stray.length > 0) {
    return stray.map(([code, value]) => ({ invariant: "I15" as const, subject: `account group ${code}`, message: `holds ${value.toFixed(2)} but is not an asset, liability, equity, revenue, cost or expense group, so the balance sheet leaves it out` }));
  }
  const at = (code: string) => net.get(code) ?? ZERO;
  const assets = at(GROUP.ASSET);
  const liabilities = at(GROUP.LIABILITY).neg();
  const equity = at(GROUP.EQUITY).neg();
  const profit = at(GROUP.REVENUE).neg().minus(at(GROUP.COST_OF_SALES)).minus(at(GROUP.EXPENSE));
  const gap = assets.minus(liabilities.plus(equity).plus(profit));
  if (!gap.eq(0)) {
    return [{ invariant: "I15", subject: "balance sheet", message: `assets ${assets.toFixed(2)}, liabilities ${liabilities.toFixed(2)} + equity ${equity.toFixed(2)} + profit ${profit.toFixed(2)}, difference ${gap.toFixed(2)}` }];
  }
  return [];
}

async function productNames(db: Db, organizationId: string, ids: string[]) {
  const rows = ids.length === 0 ? [] : await db.product.findMany({ where: { organizationId, id: { in: [...new Set(ids)] } }, select: { id: true, sku: true, name: true } });
  return new Map(rows.map((row) => [row.id, `${row.sku} ${row.name}`]));
}

async function branchNames(db: Db, organizationId: string, ids: string[]) {
  const rows = ids.length === 0 ? [] : await db.branch.findMany({ where: { organizationId, id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function stockOffItsMovements(db: Db, organizationId: string): Promise<Finding[]> {
  const rows = await db.$queryRaw<Array<{ productId: string; branchId: string; warehouseId: string; balance: Prisma.Decimal | string; ledger: Prisma.Decimal | string }>>`
    SELECT k.productId AS productId, k.branchId AS branchId, k.warehouseId AS warehouseId,
           COALESCE(b.quantity, 0) AS balance, COALESCE(m.net, 0) AS ledger
    FROM (
      SELECT productId, variantScope, branchId, warehouseId FROM stock_balances WHERE organizationId = ${organizationId}
      UNION
      SELECT productId, COALESCE(variantId, ''), branchId, COALESCE(warehouseId, '') FROM stock_ledgers WHERE organizationId = ${organizationId}
    ) k
    LEFT JOIN stock_balances b ON b.organizationId = ${organizationId} AND b.productId = k.productId AND b.variantScope = k.variantScope AND b.branchId = k.branchId AND b.warehouseId = k.warehouseId
    LEFT JOIN (
      SELECT productId, COALESCE(variantId, '') AS variantScope, branchId, COALESCE(warehouseId, '') AS warehouseId,
             SUM(CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END) AS net
      FROM stock_ledgers WHERE organizationId = ${organizationId}
      GROUP BY productId, COALESCE(variantId, ''), branchId, COALESCE(warehouseId, '')
    ) m ON m.productId = k.productId AND m.variantScope = k.variantScope AND m.branchId = k.branchId AND m.warehouseId = k.warehouseId
    WHERE COALESCE(b.quantity, 0) <> COALESCE(m.net, 0)
    ORDER BY k.productId, k.branchId
  `;
  const names = await productNames(db, organizationId, rows.map((row) => row.productId));
  const branches = await branchNames(db, organizationId, rows.map((row) => row.branchId));
  return rows.map((row) => ({
    invariant: "I4" as const,
    subject: `${names.get(row.productId) ?? row.productId} at ${branches.get(row.branchId) ?? row.branchId}`,
    message: `${dec(row.balance).toFixed(4)} on hand, the movements add up to ${dec(row.ledger).toFixed(4)} (difference ${dec(row.balance).minus(dec(row.ledger)).toFixed(4)})`,
  }));
}

async function lotsAboveStock(db: Db, organizationId: string): Promise<Finding[]> {
  const rows = await db.$queryRaw<Array<{ productId: string; branchId: string; lots: Prisma.Decimal | string; stock: Prisma.Decimal | string }>>`
    SELECT e.productId AS productId, e.branchId AS branchId, SUM(e.quantity) AS lots,
           (SELECT COALESCE(SUM(b.quantity), 0) FROM stock_balances b
            WHERE b.organizationId = e.organizationId AND b.productId = e.productId AND b.branchId = e.branchId AND b.warehouseId = e.warehouseId AND b.variantScope = COALESCE(e.variantId, '')) AS stock
    FROM expiry_batches e
    WHERE e.organizationId = ${organizationId}
    GROUP BY e.productId, e.branchId, e.warehouseId, e.variantId, e.organizationId
    HAVING SUM(e.quantity) > (SELECT COALESCE(SUM(b.quantity), 0) FROM stock_balances b
            WHERE b.organizationId = e.organizationId AND b.productId = e.productId AND b.branchId = e.branchId AND b.warehouseId = e.warehouseId AND b.variantScope = COALESCE(e.variantId, ''))
    ORDER BY e.productId
  `;
  const names = await productNames(db, organizationId, rows.map((row) => row.productId));
  const branches = await branchNames(db, organizationId, rows.map((row) => row.branchId));
  return rows.map((row) => ({
    invariant: "I7" as const,
    subject: `${names.get(row.productId) ?? row.productId} at ${branches.get(row.branchId) ?? row.branchId}`,
    message: `the lots hold ${dec(row.lots).toFixed(4)}, only ${dec(row.stock).toFixed(4)} is on hand`,
  }));
}

async function inventoryAgainstStock(db: Db, organizationId: string): Promise<Finding[]> {
  const books = await db.$queryRaw<Array<{ branchId: string | null; value: Prisma.Decimal | string | null }>>`
    SELECT l.branchId AS branchId, SUM(l.debit - l.credit) AS value
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'INVENTORY'
    WHERE l.organizationId = ${organizationId}
    GROUP BY l.branchId
  `;
  const stock = await db.$queryRaw<Array<{ branchId: string; value: Prisma.Decimal | string | null }>>`
    SELECT branchId, SUM(quantity * COALESCE(averageCost, 0)) AS value
    FROM stock_balances WHERE organizationId = ${organizationId}
    GROUP BY branchId
  `;
  const byBranch = new Map<string, { books: Prisma.Decimal; stock: Prisma.Decimal }>();
  for (const row of books) {
    byBranch.set(row.branchId ?? "", { books: dec(row.value), stock: ZERO });
  }
  for (const row of stock) {
    const entry = byBranch.get(row.branchId) ?? { books: ZERO, stock: ZERO };
    entry.stock = dec(row.value);
    byBranch.set(row.branchId, entry);
  }
  const names = await branchNames(db, organizationId, [...byBranch.keys()].filter(Boolean));
  const found: Finding[] = [];
  for (const [branchId, entry] of byBranch) {
    const gap = entry.books.minus(entry.stock);
    if (gap.abs().gt(INVENTORY_TOLERANCE)) {
      found.push({
        invariant: "I6",
        subject: branchId ? `branch ${names.get(branchId) ?? branchId}` : "no branch",
        message: `the inventory account holds ${entry.books.toFixed(2)}, the stock on hand is worth ${entry.stock.toFixed(2)} (difference ${gap.toFixed(2)})`,
      });
    }
  }
  return found;
}

/** Everything that is off in an organization's books, as findings (they fail the check) and warnings (they do not). */
export async function reconcileBooks(db: Db, organizationId: string): Promise<ReconcileResult> {
  const findings: Finding[] = [
    ...(await journalsThatDoNotBalance(db, organizationId)),
    ...(await partyLineViolations(db, organizationId)).map((row) => ({ invariant: "I2" as const, subject: `line ${row.lineId}`, message: row.problem })),
    ...(await stockOffItsMovements(db, organizationId)),
    ...(await lotsAboveStock(db, organizationId)),
    ...(await allocationViolations(db, organizationId)).map((row) => ({ invariant: "I8" as const, subject: row.id, message: row.problem })),
    ...(await trialBalanceFindings(db, organizationId)),
  ];
  const warnings = await inventoryAgainstStock(db, organizationId);
  return { findings, warnings };
}

/**
 * Throws a BooksReconcileError naming every finding when the books do not reconcile. The inventory account against the stock value
 * (I6) is a warning and does not fail the check unless `strictInventory` is set.
 */
export async function assertBooksReconcile(organizationId: string, db: Db = prisma, options: { strictInventory?: boolean } = {}): Promise<void> {
  const { findings, warnings } = await reconcileBooks(db, organizationId);
  if (findings.length > 0 || (options.strictInventory && warnings.length > 0)) {
    throw new BooksReconcileError(findings, warnings);
  }
}
