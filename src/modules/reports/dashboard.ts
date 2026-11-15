import { Prisma } from "@prisma/client";

import { addDays, businessDate, dateOnly, fiscalYear } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { alertStatus } from "@/modules/inventory/stock";
import { dec, docBranches, money, day, ZERO, type ReportCtx } from "@/modules/reports/kit";
import { findReport } from "@/modules/reports/registry";

// The dashboard (P11 task 7, 05 "ড্যাশবোর্ড"): today's cards, the last seven days of sales, orders waiting, low stock and lots about to expire. Every
// card is a figure a report publishes, taken from running that report, so a card and its report cannot differ (I16, LV-1). The answer is kept for
// 30 seconds (H7); a card says when it was made.

export type Card = { key: string; label: { en: string; bn: string }; value: string; href: string };
export type Dashboard = {
  day: string;
  madeAt: string;
  cards: Card[];
  week: Array<{ date: string; sales: string }>;
  orders: Array<{ status: string; count: number }>;
  lowStock: Array<{ product: string; branch: string; quantity: string; status: string }>;
  expiring: { expired: number; soon: number };
  /** How many identities of the day's reports do not agree (the banner). */
  mismatches: number;
  /** What the day-to-day cards need besides the figures: returns, money in, the best sellers, the biggest dues, the month and the year, the counts. */
  more: {
    returns: string;
    net: string;
    moneyIn: string;
    paidAtSale: string;
    dueCollected: string;
    grossProfit: string | null;
    customersOwing: string;
    topProducts: Array<{ name: string; quantity: string; amount: string }>;
    topDues: Array<{ name: string; owed: string; since: string | null; late: boolean }>;
    month: { sales: string; returns: string };
    year: { sales: string; from: string };
    counts: { customers: number; products: number; suppliers: number };
  };
};

const TTL_MS = 30_000;
const KEY = Symbol.for("meridian.dashboard.cache");
type Holder = { [KEY]?: Map<string, { at: number; value: Promise<Dashboard> }> };
const cache = () => ((globalThis as Holder)[KEY] ??= new Map());

const need = async (key: string, ctx: ReportCtx) => {
  const report = findReport(key);
  if (!report) {
    throw new Error(`no report ${key}`);
  }
  return report.run(ctx);
};

/** The last seven days of posted sales (a day with none is 0), from the same invoices the sales report lists. */
export async function salesByDay(ctx: Pick<ReportCtx, "organizationId" | "branchIds">, to: string, days = 7) {
  const from = addDays(to, -(days - 1));
  const rows = await prisma.sale.groupBy({ by: ["businessDate"], where: { organizationId: ctx.organizationId, status: "POSTED", businessDate: { gte: day(from), lte: day(to) }, ...docBranches(ctx) }, _sum: { total: true } });
  const byDate = new Map(rows.map((row) => [dateOnly(row.businessDate), dec(row._sum.total)]));
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    return { date, sales: money(byDate.get(date) ?? ZERO) };
  });
}

async function build(ctx: ReportCtx): Promise<Dashboard> {
  const keys = ["sales", "receive", "payment", "cash", "bank", "due", "condition", "expenses", "stock", ...(ctx.canProfit ? ["profit"] : [])];
  const ran = await Promise.all(keys.map((key) => need(key, ctx)));
  const by = new Map(ran.map((result) => [result.key, result]));
  const [sales, receive, payment, cash, bank, due, condition, expenses, stock, profit] = ["sales", "receive", "payment", "cash", "bank", "due", "condition", "expenses", "stock", "profit"].map((key) => by.get(key));
  const results = ran;
  const figure = (result: { figures?: Record<string, string> } | undefined | null, name: string) => result?.figures?.[name] ?? "0.00";
  const view = (key: string) => `/reports/view?r=${key}&from=${ctx.from}&to=${ctx.to}`;
  const cards: Card[] = [
    { key: "sales", label: { en: "Today's sales", bn: "আজকের বিক্রি" }, value: figure(sales, "sales"), href: view("sales") },
    { key: "paid", label: { en: "Paid at the sale", bn: "বিক্রির সময় পাওয়া" }, value: figure(sales, "paidSameDay"), href: view("sales") },
    { key: "newDue", label: { en: "New due", bn: "নতুন বাকি" }, value: figure(sales, "stillOwed"), href: view("sales") },
    { key: "dueCollected", label: { en: "Due collected", bn: "বাকি আদায়" }, value: figure(receive, "dueCollected"), href: view("receive") },
    { key: "expenses", label: { en: "Expenses", bn: "খরচ" }, value: figure(expenses, "total"), href: view("expenses") },
    ...(ctx.canProfit ? [{ key: "profit", label: { en: "Today's profit", bn: "আজকের লাভ" }, value: figure(profit, "net"), href: view("profit") }] : []),
    { key: "cash", label: { en: "Cash balance", bn: "ক্যাশ ব্যালান্স" }, value: figure(cash, "closing"), href: view("cash") },
    { key: "bank", label: { en: "Bank and mobile", bn: "ব্যাংক + মোবাইল" }, value: figure(bank, "closing"), href: view("bank") },
    { key: "courier", label: { en: "Held by couriers", bn: "কুরিয়ারে আটকে" }, value: figure(condition, "owed"), href: view("condition") },
    { key: "customersOwe", label: { en: "Customers owe", bn: "কাস্টমারের বাকি" }, value: figure(due, "customersOwe"), href: view("due") },
    { key: "vendorsOwed", label: { en: "Owed to vendors", bn: "Vendor-এর পাওনা" }, value: figure(due, "vendorsOwed"), href: view("due") },
    { key: "paidOut", label: { en: "Money paid out", bn: "টাকা বাইরে গেছে" }, value: figure(payment, "total"), href: view("payment") },
    ...(ctx.canProfit ? [{ key: "stockValue", label: { en: "Stock value (at cost)", bn: "স্টকের মূল্য" }, value: figure(stock, "value"), href: view("stock") }] : []),
    { key: "lowStock", label: { en: "Low or out of stock", bn: "LOW/OUT স্টক" }, value: figure(stock, "lowOrOut"), href: view("stock") },
  ];
  const mismatches = results.reduce((sum, result) => sum + result.identities.filter((check) => !check.ok).length, 0);

  const startMonth = (await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { fiscalYearStartMonth: true } })).fiscalYearStartMonth;
  const yearFrom = fiscalYear(ctx.to, startMonth).start;
  const monthFrom = `${ctx.to.slice(0, 7)}-01`;
  const posted = { organizationId: ctx.organizationId, status: "POSTED" as const, ...docBranches(ctx) };
  const [week, orders, low, lots, top, monthSales, monthReturns, yearSales, customerCount, productCount, supplierCount] = await Promise.all([
    salesByDay(ctx, ctx.to),
    prisma.salesOrder.groupBy({ by: ["status"], where: { organizationId: ctx.organizationId, isQuotation: false, status: { in: ["CONFIRMED", "PACKED", "DISPATCHED"] }, ...docBranches(ctx) }, _count: { _all: true } }),
    stockAlerts(ctx),
    prisma.expiryBatch.findMany({ where: { organizationId: ctx.organizationId, quantity: { gt: 0 }, expiresOn: { lte: day(addDays(ctx.to, 30)) }, ...docBranches(ctx) }, select: { expiresOn: true } }),
    bestSellers(ctx),
    prisma.sale.aggregate({ where: { ...posted, businessDate: { gte: day(monthFrom), lte: day(ctx.to) } }, _sum: { total: true } }),
    prisma.saleReturn.aggregate({ where: { ...posted, businessDate: { gte: day(monthFrom), lte: day(ctx.to) } }, _sum: { total: true } }),
    prisma.sale.aggregate({ where: { ...posted, businessDate: { gte: day(yearFrom), lte: day(ctx.to) } }, _sum: { total: true } }),
    prisma.customer.count({ where: { organizationId: ctx.organizationId } }),
    prisma.product.count({ where: { organizationId: ctx.organizationId, deletedAt: null } }),
    prisma.supplier.count({ where: { organizationId: ctx.organizationId } }),
  ]);
  // the biggest customer dues come from the due report that already ran (its rows are worst first), so no second query
  const dueRows = (due?.sections.find((section) => section.key === "customers")?.rows ?? []) as Array<Record<string, string>>;
  const topDues = dueRows
    .filter((row) => Number(row.closing) > 0)
    .slice(0, 5)
    .map((row) => ({ name: row.name ?? "", owed: row.closing ?? "0.00", since: row.since ? row.since : null, late: row.late === "Yes" || row.late === "হ্যাঁ" || row.late === "true" }));
  const todayMs = day(ctx.to).getTime();
  return {
    day: ctx.to,
    madeAt: new Date().toISOString(),
    cards,
    week,
    orders: orders.map((row) => ({ status: row.status, count: row._count._all })),
    lowStock: low,
    expiring: { expired: lots.filter((lot) => lot.expiresOn.getTime() < todayMs).length, soon: lots.filter((lot) => lot.expiresOn.getTime() >= todayMs).length },
    mismatches,
    more: {
      returns: figure(sales, "returns"),
      net: figure(sales, "net"),
      moneyIn: figure(receive, "withoutTransfers"),
      paidAtSale: figure(sales, "paidSameDay"),
      dueCollected: figure(receive, "dueCollected"),
      grossProfit: ctx.canProfit ? figure(profit, "gross") : null,
      customersOwing: figure(due, "customersOwing"),
      topProducts: top,
      topDues,
      month: { sales: money(dec(monthSales._sum.total)), returns: money(dec(monthReturns._sum.total)) },
      year: { sales: money(dec(yearSales._sum.total)), from: yearFrom },
      counts: { customers: customerCount, products: productCount, suppliers: supplierCount },
    },
  };
}

/** The five products that brought in most today (posted sales of the branches), by line total. */
async function bestSellers(ctx: Pick<ReportCtx, "organizationId" | "branchIds" | "to">) {
  const rows = await prisma.$queryRaw<Array<{ name: string; quantity: Prisma.Decimal; amount: Prisma.Decimal }>>`
    SELECT p.name AS name, SUM(si.quantity) AS quantity, SUM(si.lineTotal) AS amount
    FROM sale_items si
    JOIN sales s ON s.id = si.saleId AND s.status = 'POSTED' AND s.businessDate = ${ctx.to}
    JOIN products p ON p.id = si.productId
    WHERE si.organizationId = ${ctx.organizationId}
      ${ctx.branchIds === null ? Prisma.empty : ctx.branchIds.length === 0 ? Prisma.sql`AND 1 = 0` : Prisma.sql`AND s.branchId IN (${Prisma.join(ctx.branchIds)})`}
    GROUP BY p.id, p.name
    ORDER BY amount DESC
    LIMIT 5
  `;
  return rows.map((row) => ({ name: row.name, quantity: dec(row.quantity).toDecimalPlaces(2).toString(), amount: money(dec(row.amount)) }));
}

/** Products at or under their reorder level in the branches, worst first (10). */
async function stockAlerts(ctx: Pick<ReportCtx, "organizationId" | "branchIds">) {
  const rows = await prisma.$queryRaw<Array<{ product: string; branch: string; quantity: Prisma.Decimal; reorder: Prisma.Decimal }>>`
    SELECT p.name AS product, b.name AS branch, sb.quantity AS quantity, p.reorderLevel AS reorder
    FROM stock_balances sb
    JOIN products p ON p.id = sb.productId AND p.deletedAt IS NULL AND p.reorderLevel > 0
    JOIN branches b ON b.id = sb.branchId
    WHERE sb.organizationId = ${ctx.organizationId} AND sb.quantity <= p.reorderLevel
      ${ctx.branchIds === null ? Prisma.empty : ctx.branchIds.length === 0 ? Prisma.sql`AND 1 = 0` : Prisma.sql`AND sb.branchId IN (${Prisma.join(ctx.branchIds)})`}
    ORDER BY sb.quantity / p.reorderLevel ASC, p.name
    LIMIT 10
  `;
  return rows.map((row) => ({ product: row.product, branch: row.branch, quantity: dec(row.quantity).toDecimalPlaces(4).toString(), status: alertStatus(dec(row.quantity), dec(row.reorder)) }));
}

/** Today's dashboard for these branches, kept for 30 seconds. */
export function dashboardFor(ctx: Omit<ReportCtx, "from" | "to">, date: string = businessDate()): Promise<Dashboard> {
  const key = `${ctx.organizationId}|${ctx.branchIds?.join(",") ?? "all"}|${date}|${ctx.canProfit}`;
  const kept = cache().get(key);
  if (kept && Date.now() - kept.at < TTL_MS) {
    return kept.value;
  }
  const value = build({ ...ctx, from: date, to: date });
  cache().set(key, { at: Date.now(), value });
  value.catch(() => cache().delete(key));
  if (cache().size > 200) {
    cache().clear();
  }
  return value;
}

export function forgetDashboards() {
  cache().clear();
}
