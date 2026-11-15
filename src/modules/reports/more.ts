import { Prisma } from "@prisma/client";

import { GROUP } from "@/core/ledger/groups";
import { paymentStatuses } from "@/core/payments";
import { addDays, businessDate, dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { assetRegister } from "@/modules/assets/assets";
import { kindOf, moneyLines } from "@/modules/reports/daily-money";
import { accountTotals, chart, col, day, dayBefore, dec, docBranches, hasRole, identity, isMoney, lineBranches, money, netOf, sumOf, t, ZERO, type ChartAccount, type ReportCtx, type ReportResult } from "@/modules/reports/kit";

// The monthly and other reports (05 table): profit by month, district by month, payment status and age, product margin, stock value, lots and
// expiry, take-off and damage, VAT, assets, trial balance, balance sheet, cash flow, day book and every transaction. Each from the ledger.

const monthOf = (date: string) => date.slice(0, 7);
function months(ctx: ReportCtx) {
  // a single day asked: the twelve months up to it; a range: its months (at most 24)
  const last = monthOf(ctx.to);
  const first = ctx.from === ctx.to ? shiftMonth(last, -11) : monthOf(ctx.from);
  const list: string[] = [];
  for (let month = first; month <= last && list.length < 24; month = shiftMonth(month, 1)) {
    list.push(month);
  }
  return list;
}
function shiftMonth(month: string, by: number) {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + number - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
const monthEnd = (month: string) => addDays(`${shiftMonth(month, 1)}-01`, -1);

async function monthlyTotals(ctx: ReportCtx, first: string, last: string) {
  const rows = await prisma.$queryRaw<Array<{ month: string; accountId: string; debit: Prisma.Decimal | null; credit: Prisma.Decimal | null }>>`
    SELECT DATE_FORMAT(l.businessDate, '%Y-%m') AS month, l.accountId AS accountId, SUM(l.debit) AS debit, SUM(l.credit) AS credit
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED' AND (j.docType IS NULL OR j.docType <> 'YEAR_CLOSE')
    WHERE l.organizationId = ${ctx.organizationId} ${lineBranches(ctx)} AND l.businessDate BETWEEN ${`${first}-01`} AND ${monthEnd(last)}
    GROUP BY month, l.accountId
  `;
  const byMonth = new Map<string, Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>>();
  for (const row of rows) {
    const map = byMonth.get(row.month) ?? new Map();
    map.set(row.accountId, { debit: dec(row.debit), credit: dec(row.credit) });
    byMonth.set(row.month, map);
  }
  return byMonth;
}

const PL_LINES: Array<{ key: string; en: string; bn: string; value: (accounts: ChartAccount[], totals: Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>) => Prisma.Decimal }> = [
  { key: "sales", en: "Net sales", bn: "নিট বিক্রি", value: (a, m) => netOf(m, a, hasRole("SALES")).neg() },
  { key: "charge", en: "Charge income", bn: "চার্জ আয়", value: (a, m) => netOf(m, a, hasRole("CHARGE_INCOME")).neg() },
  { key: "cogs", en: "Cost of goods sold", bn: "বিক্রিত পণ্যের ব্যয়", value: (a, m) => netOf(m, a, hasRole("COGS")) },
  { key: "stock", en: "Stock loss less gain", bn: "স্টক ক্ষতি − লাভ", value: (a, m) => netOf(m, a, (x) => x.roles.includes("INVENTORY_LOSS") || x.roles.includes("INVENTORY_GAIN")) },
  { key: "expenses", en: "Expenses", bn: "খরচ", value: (a, m) => netOf(m, a, (x) => x.group === GROUP.EXPENSE) },
  { key: "other", en: "Other income", bn: "অন্যান্য আয়", value: (a, m) => netOf(m, a, (x) => x.group === GROUP.REVENUE && !x.roles.some((r) => ["SALES", "CHARGE_INCOME", "INVENTORY_GAIN"].includes(r))).neg() },
  { key: "ppv", en: "Purchase price variance and other cost", bn: "PPV ও অন্যান্য ব্যয়", value: (a, m) => netOf(m, a, (x) => x.group === GROUP.COST_OF_SALES && !x.roles.some((r) => ["COGS", "INVENTORY_LOSS"].includes(r))) },
];
const netProfit = (a: ChartAccount[], m: Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>) => netOf(m, a, (x) => x.group === GROUP.REVENUE || x.group === GROUP.COST_OF_SALES || x.group === GROUP.EXPENSE).neg();

export async function monthlyProfit(ctx: ReportCtx): Promise<ReportResult> {
  const list = months(ctx);
  const [accounts, now, lastYear] = await Promise.all([chart(ctx.organizationId), monthlyTotals(ctx, list[0], list[list.length - 1]), monthlyTotals(ctx, shiftMonth(list[0], -12), shiftMonth(list[list.length - 1], -12))]);
  const empty = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
  const merge = (maps: Array<Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>>) => {
    const out = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const map of maps) {
      for (const [id, row] of map) {
        const have = out.get(id) ?? { debit: ZERO, credit: ZERO };
        out.set(id, { debit: have.debit.plus(row.debit), credit: have.credit.plus(row.credit) });
      }
    }
    return out;
  };
  const all = merge(list.map((month) => now.get(month) ?? empty));
  const before = merge([...lastYear.values()]);
  const rows = [
    ...PL_LINES.map((line) => ({ line: `${line.en} / ${line.bn}`, ...Object.fromEntries(list.map((month) => [month, money(line.value(accounts, now.get(month) ?? empty))])), total: money(line.value(accounts, all)), lastYear: money(line.value(accounts, before)) })),
    { line: "= Net profit / নিট লাভ", ...Object.fromEntries(list.map((month) => [month, money(netProfit(accounts, now.get(month) ?? empty))])), total: money(netProfit(accounts, all)), lastYear: money(netProfit(accounts, before)) },
  ];
  const window = await accountTotals(ctx, `${list[0]}-01`, monthEnd(list[list.length - 1]), { excludeClose: true });
  return {
    key: "monthly-profit",
    title: t("Profit and loss by month", "মাসিক লাভ-ক্ষতি"),
    from: `${list[0]}-01`,
    to: monthEnd(list[list.length - 1]),
    summary: [
      { label: t("Net profit", "নিট লাভ"), value: money(netProfit(accounts, all)) },
      { label: t("Same months last year", "গত বছরের একই মাসগুলো"), value: money(netProfit(accounts, before)) },
    ],
    sections: [{ key: "months", title: t("By month", "মাস অনুযায়ী"), columns: [col("line", "Line", "লাইন"), ...list.map((month) => col(month, month, month, true)), col("total", "Total", "মোট", true), col("lastYear", "Last year", "গত বছর", true)], rows }],
    identities: [identity(t("The months add up to the period's profit in the ledger", "মাসগুলোর যোগফল = পুরো সময়ের লাভ"), list.reduce((sum, month) => sum.plus(netProfit(accounts, now.get(month) ?? empty)), ZERO), netProfit(accounts, window))],
  };
}

export async function districtMonth(ctx: ReportCtx): Promise<ReportResult> {
  const list = months(ctx);
  const from = `${list[0]}-01`;
  const to = monthEnd(list[list.length - 1]);
  const rows = await prisma.$queryRaw<Array<{ district: string | null; month: string; sales: Prisma.Decimal | null; invoices: bigint; customers: bigint }>>`
    SELECT d.name AS district, DATE_FORMAT(s.businessDate, '%Y-%m') AS month, SUM(s.total) AS sales, COUNT(*) AS invoices, COUNT(DISTINCT s.customerId) AS customers
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customerId
    LEFT JOIN districts d ON d.id = c.districtId
    WHERE s.organizationId = ${ctx.organizationId} AND s.status = 'POSTED' ${lineBranches(ctx, "s")} AND s.businessDate BETWEEN ${from} AND ${to}
    GROUP BY d.name, month
  `;
  const owing = await prisma.$queryRaw<Array<{ district: string | null; owed: Prisma.Decimal | null }>>`
    SELECT d.name AS district, SUM(l.debit - l.credit) AS owed
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'AR'
    LEFT JOIN customers c ON c.id = l.partyId
    LEFT JOIN districts d ON d.id = c.districtId
    WHERE l.organizationId = ${ctx.organizationId} ${lineBranches(ctx)} AND l.businessDate <= ${to}
    GROUP BY d.name
  `;
  const districts = [...new Set([...rows.map((row) => row.district ?? "No district"), ...owing.map((row) => row.district ?? "No district")])].sort();
  const owed = new Map(owing.map((row) => [row.district ?? "No district", dec(row.owed)]));
  const salesTable = districts.map((district) => {
    const mine = rows.filter((row) => (row.district ?? "No district") === district);
    const total = sumOf(mine, (row) => dec(row.sales));
    const invoices = mine.reduce((sum, row) => sum + Number(row.invoices), 0);
    return {
      district,
      ...Object.fromEntries(list.map((month) => [month, money(dec(mine.find((row) => row.month === month)?.sales))])),
      total: money(total),
      customers: String(mine.reduce((sum, row) => Math.max(sum, Number(row.customers)), 0)),
      average: invoices > 0 ? money(total.div(invoices)) : "0.00",
      owed: money(owed.get(district) ?? ZERO),
    };
  });
  const all = await prisma.sale.aggregate({ where: { organizationId: ctx.organizationId, status: "POSTED", businessDate: { gte: day(from), lte: day(to) }, ...docBranches(ctx) }, _sum: { total: true } });
  return {
    key: "district-month",
    title: t("Districts by month", "জেলা × মাস"),
    from,
    to,
    summary: [{ label: t("Sales", "বিক্রি"), value: money(dec(all._sum.total)) }],
    sections: [{ key: "districts", title: t("Sales by district", "জেলা অনুযায়ী বিক্রি"), columns: [col("district", "District", "জেলা"), ...list.map((month) => col(month, month, month, true)), col("total", "Total", "মোট", true), col("customers", "Customers (busiest month)", "কাস্টমার", true), col("average", "Average invoice", "গড় ইনভয়েস", true), col("owed", "Owed now", "বাকি", true)], rows: salesTable }],
    identities: [identity(t("Districts add up to all sales", "জেলাগুলোর যোগফল = মোট বিক্রি"), sumOf(salesTable, (row) => dec(row.total)), dec(all._sum.total))],
  };
}

export async function paymentStatusReport(ctx: ReportCtx): Promise<ReportResult> {
  const where = { organizationId: ctx.organizationId, businessDate: { gte: day(ctx.from), lte: day(ctx.to) }, ...docBranches(ctx) };
  const [sales, purchases] = await Promise.all([
    prisma.sale.findMany({ where: { ...where, status: "POSTED" }, orderBy: { businessDate: "asc" }, take: 2000, select: { id: true, total: true, businessDate: true, invoice: { select: { number: true } }, customer: { select: { name: true, paymentDays: true } } } }),
    prisma.purchase.findMany({ where: { ...where, status: "RECEIVED" }, orderBy: { businessDate: "asc" }, take: 2000, select: { id: true, number: true, total: true, businessDate: true, supplier: { select: { name: true, paymentDays: true } } } }),
  ]);
  const [saleStatus, billStatus] = await Promise.all([paymentStatuses(prisma, ctx.organizationId, "CUSTOMER", sales), paymentStatuses(prisma, ctx.organizationId, "VENDOR", purchases)]);
  const age = (date: Date) => Math.round((day(ctx.to).getTime() - date.getTime()) / 86_400_000);
  const bucket = (days: number) => (days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+");
  const lines = (docs: Array<{ id: string; number: string | null; total: Prisma.Decimal; businessDate: Date; party: string; days: number | null }>, status: Map<string, { status: string; owed: Prisma.Decimal }>) =>
    docs.map((doc) => {
      const paid = status.get(doc.id);
      const days = age(doc.businessDate);
      return { number: doc.number ?? "", date: dateOnly(doc.businessDate), party: doc.party, total: money(doc.total), owed: money(paid?.owed ?? ZERO), status: paid?.status ?? "UNPAID", age: days, bucket: (paid?.owed ?? ZERO).gt(0) ? bucket(days) : "", late: (paid?.owed ?? ZERO).gt(0) && days > (doc.days ?? 0) ? "Yes" : "" };
    });
  const invoiceRows = lines(sales.map((row) => ({ id: row.id, number: row.invoice?.number ?? null, total: row.total, businessDate: row.businessDate, party: row.customer?.name ?? "Walk-in", days: row.customer?.paymentDays ?? 0 })), saleStatus);
  const billRows = lines(purchases.map((row) => ({ id: row.id, number: row.number, total: row.total, businessDate: row.businessDate, party: row.supplier.name, days: row.supplier.paymentDays ?? 0 })), billStatus);
  const columns = [col("number", "Number", "নম্বর"), col("date", "Date", "তারিখ"), col("party", "Party", "পার্টি"), col("total", "Total", "মোট", true), col("owed", "Still owed", "বাকি", true), col("status", "Status", "অবস্থা"), col("age", "Days", "দিন", true), col("bucket", "Age", "বয়স"), col("late", "Overdue", "ওভারডিউ")];
  const count = (rows: typeof invoiceRows, status: string) => String(rows.filter((row) => row.status === status).length);
  const owedBy = (rows: typeof invoiceRows) => ["0-30", "31-60", "61-90", "90+"].map((name) => ({ bucket: name, owed: money(sumOf(rows.filter((row) => row.bucket === name), (row) => dec(row.owed))) }));
  return {
    key: "payment-status",
    title: t("Payment status and age", "পেমেন্ট স্ট্যাটাস ও বয়স"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Invoices unpaid / partial / paid", "ইনভয়েস বাকি / আংশিক / পরিশোধিত"), value: `${count(invoiceRows, "UNPAID")} / ${count(invoiceRows, "PARTIAL")} / ${count(invoiceRows, "PAID")}` },
      { label: t("Bills unpaid / partial / paid", "বিল বাকি / আংশিক / পরিশোধিত"), value: `${count(billRows, "UNPAID")} / ${count(billRows, "PARTIAL")} / ${count(billRows, "PAID")}` },
    ],
    sections: [
      { key: "invoice-age", title: t("Invoices still owed, by age", "বাকি ইনভয়েস, বয়স অনুযায়ী"), columns: [col("bucket", "Days", "দিন"), col("owed", "Owed", "বাকি", true)], rows: owedBy(invoiceRows) },
      { key: "invoices", title: t("Invoices", "ইনভয়েস"), columns, rows: invoiceRows },
      { key: "bill-age", title: t("Bills still owed, by age", "বাকি বিল, বয়স অনুযায়ী"), columns: [col("bucket", "Days", "দিন"), col("owed", "Owed", "বাকি", true)], rows: owedBy(billRows) },
      { key: "bills", title: t("Bills", "বিল"), columns, rows: billRows },
    ],
    identities: [],
  };
}

export async function productMargin(ctx: ReportCtx): Promise<ReportResult> {
  const rows = await prisma.$queryRaw<Array<{ product: string; sku: string; category: string | null; brand: string | null; quantity: Prisma.Decimal | null; sales: Prisma.Decimal | null; cost: Prisma.Decimal | null }>>`
    SELECT p.name AS product, p.sku AS sku, c.name AS category, b.name AS brand, SUM(i.quantity) AS quantity, SUM(i.lineTotal - COALESCE(i.vatAmount, 0)) AS sales, SUM(ROUND(i.quantity * COALESCE(i.unitCost, 0), 2)) AS cost
    FROM sale_items i
    JOIN sales s ON s.id = i.saleId AND s.status = 'POSTED'
    JOIN products p ON p.id = i.productId
    LEFT JOIN categories c ON c.id = p.categoryId
    LEFT JOIN brands b ON b.id = p.brandId
    WHERE s.organizationId = ${ctx.organizationId} ${lineBranches(ctx, "s")} AND s.businessDate BETWEEN ${ctx.from} AND ${ctx.to}
    GROUP BY p.id, p.name, p.sku, c.name, b.name
    ORDER BY sales DESC
  `;
  const shown = rows.map((row) => {
    const sales = dec(row.sales);
    const cost = dec(row.cost);
    return { product: `${row.product} (${row.sku})`, category: row.category ?? "", brand: row.brand ?? "", quantity: dec(row.quantity).toDecimalPlaces(4).toString(), sales: money(sales), cost: money(cost), margin: money(sales.minus(cost)), percent: sales.gt(0) ? `${sales.minus(cost).div(sales).mul(100).toDecimalPlaces(1).toString()}%` : "", raw: { sales, cost } };
  });
  const invoices = await prisma.sale.aggregate({ where: { organizationId: ctx.organizationId, status: "POSTED", businessDate: { gte: day(ctx.from), lte: day(ctx.to) }, ...docBranches(ctx) }, _sum: { total: true, vatTotal: true, chargesTotal: true } });
  const totalSales = sumOf(shown, (row) => row.raw.sales);
  return {
    key: "product-margin",
    title: t("Sales and margin by product", "পণ্যভিত্তিক বিক্রি ও মার্জিন"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Sales", "বিক্রি"), value: money(totalSales) },
      { label: t("Margin", "মার্জিন"), value: money(totalSales.minus(sumOf(shown, (row) => row.raw.cost))) },
    ],
    sections: [{ key: "products", title: t("Products", "পণ্য"), columns: [col("product", "Product", "পণ্য"), col("category", "Category", "ক্যাটাগরি"), col("brand", "Brand", "ব্র্যান্ড"), col("quantity", "Quantity", "পরিমাণ", true), col("sales", "Sales", "বিক্রি", true), col("cost", "Cost", "খরচ", true), col("margin", "Margin", "মার্জিন", true), col("percent", "Margin %", "মার্জিন %", true)], rows: shown.map(({ raw, ...row }) => (void raw, row)) }],
    identities: [identity(t("Lines add up to the invoices (less VAT and charges)", "লাইনগুলোর যোগফল = ইনভয়েস (VAT ও চার্জ বাদে)"), totalSales, dec(invoices._sum.total).minus(dec(invoices._sum.vatTotal)).minus(dec(invoices._sum.chargesTotal)))],
  };
}

export async function stockValue(ctx: ReportCtx): Promise<ReportResult> {
  const rows = await prisma.$queryRaw<Array<{ product: string; sku: string; category: string | null; quantity: Prisma.Decimal | null; value: Prisma.Decimal | null }>>`
    SELECT p.name AS product, p.sku AS sku, c.name AS category,
           SUM(CASE WHEN s.direction = 'IN' THEN s.quantity ELSE -s.quantity END) AS quantity,
           SUM(CASE WHEN s.direction = 'IN' THEN 1 ELSE -1 END * COALESCE(s.totalCost, ROUND(s.quantity * s.unitCost, 2), ROUND(s.quantity * (SELECT AVG(b.averageCost) FROM stock_balances b WHERE b.productId = s.productId AND b.branchId = s.branchId), 2), 0)) AS value
    FROM stock_ledgers s
    JOIN products p ON p.id = s.productId
    LEFT JOIN categories c ON c.id = p.categoryId
    WHERE s.organizationId = ${ctx.organizationId} ${lineBranches(ctx, "s")} AND s.businessDate <= ${ctx.to}
    GROUP BY p.id, p.name, p.sku, c.name
    HAVING quantity <> 0 OR value <> 0
    ORDER BY p.name
  `;
  const [accounts, totals] = await Promise.all([chart(ctx.organizationId), accountTotals(ctx, null, ctx.to)]);
  const value = sumOf(rows, (row) => dec(row.value));
  const byCategory = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    byCategory.set(row.category ?? "No category", (byCategory.get(row.category ?? "No category") ?? ZERO).plus(dec(row.value)));
  }
  return {
    key: "stock-value",
    title: t("Stock value", "স্টক ভ্যালুয়েশন"),
    from: ctx.to,
    to: ctx.to,
    summary: [{ label: t("Value at average cost", "গড় খরচে মূল্য"), value: money(value) }],
    sections: [
      { key: "categories", title: t("By category", "ক্যাটাগরি অনুযায়ী"), columns: [col("category", "Category", "ক্যাটাগরি"), col("value", "Value", "মূল্য", true)], rows: [...byCategory].map(([category, amount]) => ({ category, value: money(amount) })) },
      { key: "products", title: t("Products", "পণ্য"), columns: [col("product", "Product", "পণ্য"), col("category", "Category", "ক্যাটাগরি"), col("quantity", "Quantity", "পরিমাণ", true), col("cost", "Average cost", "গড় খরচ", true), col("value", "Value", "মূল্য", true)], rows: rows.map((row) => ({ product: `${row.product} (${row.sku})`, category: row.category ?? "", quantity: dec(row.quantity).toDecimalPlaces(4).toString(), cost: dec(row.quantity).gt(0) ? dec(row.value).div(dec(row.quantity)).toDecimalPlaces(4).toString() : "", value: money(dec(row.value)) })), total: { value: money(value) } },
    ],
    identities: [identity(t("Stock value = inventory (1400) balance on that day", "স্টকের মূল্য = সেদিনের ইনভেন্টরি (1400) ব্যালান্স"), value, netOf(totals, accounts, hasRole("INVENTORY")))],
  };
}

export async function expiryReport(ctx: ReportCtx): Promise<ReportResult> {
  const lots = await prisma.expiryBatch.findMany({ where: { organizationId: ctx.organizationId, quantity: { gt: 0 }, ...docBranches(ctx) }, orderBy: { expiresOn: "asc" }, include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } } });
  const costs = await prisma.stockBalance.findMany({ where: { organizationId: ctx.organizationId, productId: { in: [...new Set(lots.map((lot) => lot.productId))] } }, select: { productId: true, warehouseId: true, averageCost: true } });
  const costOf = new Map(costs.map((row) => [`${row.productId}|${row.warehouseId}`, dec(row.averageCost)]));
  const rows = lots.map((lot) => {
    const left = Math.round((lot.expiresOn.getTime() - day(ctx.to).getTime()) / 86_400_000);
    const value = lot.quantity.mul(costOf.get(`${lot.productId}|${lot.warehouseId}`) ?? ZERO).toDecimalPlaces(2);
    return { product: `${lot.product.name} (${lot.product.sku})`, warehouse: lot.warehouse.name, lot: lot.lot, expires: dateOnly(lot.expiresOn), left, quantity: lot.quantity.toDecimalPlaces(4).toString(), value: ctx.canProfit ? money(value) : "", state: left < 0 ? "EXPIRED" : left <= 30 ? "SOON" : "", raw: value };
  });
  return {
    key: "expiry",
    title: t("Lots and expiry", "মেয়াদ ও লট"),
    from: ctx.to,
    to: ctx.to,
    summary: [
      { label: t("Expired lots", "মেয়াদ শেষ লট"), value: String(rows.filter((row) => row.state === "EXPIRED").length) },
      { label: t("Expiring in 30 days", "৩০ দিনে মেয়াদ শেষ"), value: String(rows.filter((row) => row.state === "SOON").length) },
    ],
    sections: [{ key: "lots", title: t("Lots", "লট"), columns: [col("product", "Product", "পণ্য"), col("warehouse", "Warehouse", "গুদাম"), col("lot", "Lot", "লট"), col("expires", "Expires", "মেয়াদ"), col("left", "Days left", "বাকি দিন", true), col("quantity", "Quantity", "পরিমাণ", true), ...(ctx.canProfit ? [col("value", "Value", "মূল্য", true)] : []), col("state", "State", "অবস্থা")], rows: rows.map(({ raw, ...row }) => (void raw, row)) }],
    identities: [],
  };
}

export async function takeOffDamage(ctx: ReportCtx): Promise<ReportResult> {
  const docs = await prisma.stockDocument.findMany({
    where: { organizationId: ctx.organizationId, type: { in: ["DAMAGE", "EXPIRY", "TAKE_OFF"] }, businessDate: { gte: day(ctx.from), lte: day(ctx.to) }, ...docBranches(ctx) },
    orderBy: { businessDate: "asc" },
    select: { id: true, type: true, number: true, businessDate: true, reason: true, takeOffPurpose: true, journalId: true },
  });
  const movements = await prisma.stockLedger.findMany({ where: { organizationId: ctx.organizationId, referenceType: "stock_document", referenceId: { in: docs.map((doc) => doc.id) } }, select: { referenceId: true, quantity: true, totalCost: true, product: { select: { name: true } } } });
  const credits = docs.length > 0 ? await prisma.$queryRaw<Array<{ value: Prisma.Decimal | null }>>`
    SELECT SUM(l.credit - l.debit) AS value FROM journal_lines l
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'INVENTORY'
    WHERE l.organizationId = ${ctx.organizationId} AND l.journalId IN (${Prisma.join(docs.map((doc) => doc.journalId ?? ""))})
  ` : [{ value: null }];
  const rows = docs.flatMap((doc) =>
    movements
      .filter((row) => row.referenceId === doc.id)
      .map((row) => ({ date: dateOnly(doc.businessDate), number: doc.number ?? "", kind: doc.type === "TAKE_OFF" ? `Take-off: ${doc.takeOffPurpose ?? ""}` : doc.type === "EXPIRY" ? "Expired" : "Damage", reason: doc.reason ?? "", product: row.product.name, quantity: row.quantity.toDecimalPlaces(4).toString(), value: money(dec(row.totalCost)), raw: dec(row.totalCost) })),
  );
  const byKind = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    byKind.set(row.kind, (byKind.get(row.kind) ?? ZERO).plus(row.raw));
  }
  const total = sumOf(rows, (row) => row.raw);
  return {
    key: "takeoff-damage",
    title: t("Take-off and damage", "Take-off ও ড্যামেজ"),
    from: ctx.from,
    to: ctx.to,
    summary: [{ label: t("Value", "মূল্য"), value: money(total) }],
    sections: [
      { key: "kinds", title: t("By purpose or reason", "উদ্দেশ্য/কারণ অনুযায়ী"), columns: [col("kind", "Kind", "ধরন"), col("value", "Value", "মূল্য", true)], rows: [...byKind].map(([kind, value]) => ({ kind, value: money(value) })) },
      { key: "lines", title: t("Each one", "প্রতিটি"), columns: [col("date", "Date", "তারিখ"), col("number", "Number", "নম্বর"), col("kind", "Kind", "ধরন"), col("reason", "Reason", "কারণ"), col("product", "Product", "পণ্য"), col("quantity", "Quantity", "পরিমাণ", true), col("value", "Value", "মূল্য", true)], rows: rows.map(({ raw, ...row }) => (void raw, row)), total: { value: money(total) } },
    ],
    identities: [identity(t("Value = what their journals took off inventory", "মূল্য = জার্নালে ইনভেন্টরি থেকে কমেছে"), total, dec(credits[0]?.value))],
  };
}

export async function vatReport(ctx: ReportCtx): Promise<ReportResult> {
  const list = months(ctx);
  const [accounts, totals] = await Promise.all([chart(ctx.organizationId), monthlyTotals(ctx, list[0], list[list.length - 1])]);
  const empty = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
  const rows = list.map((month) => {
    const map = totals.get(month) ?? empty;
    const output = netOf(map, accounts, hasRole("OUTPUT_VAT")).neg();
    const input = netOf(map, accounts, hasRole("INPUT_VAT"));
    return { month, output, input, net: output.minus(input) };
  });
  const window = await accountTotals(ctx, `${list[0]}-01`, monthEnd(list[list.length - 1]));
  return {
    key: "vat",
    title: t("VAT", "VAT"),
    from: `${list[0]}-01`,
    to: monthEnd(list[list.length - 1]),
    summary: [{ label: t("Net VAT to pay", "নিট প্রদেয় VAT"), value: money(sumOf(rows, (row) => row.net)) }],
    sections: [{ key: "months", title: t("By month", "মাস অনুযায়ী"), columns: [col("month", "Month", "মাস"), col("output", "Output VAT (sales)", "আউটপুট", true), col("input", "Input VAT (purchases)", "ইনপুট", true), col("net", "To pay", "প্রদেয়", true)], rows: rows.map((row) => ({ month: row.month, output: money(row.output), input: money(row.input), net: money(row.net) })) }],
    identities: [identity(t("Months add up to the VAT accounts' movement", "মাসগুলোর যোগফল = VAT অ্যাকাউন্টের নড়াচড়া"), sumOf(rows, (row) => row.net), netOf(window, accounts, hasRole("OUTPUT_VAT")).neg().minus(netOf(window, accounts, hasRole("INPUT_VAT"))))],
  };
}

export async function assetsReport(ctx: ReportCtx): Promise<ReportResult> {
  const register = await assetRegister(ctx.organizationId);
  const [accounts, totals] = await Promise.all([chart(ctx.organizationId), accountTotals({ ...ctx, branchIds: null }, null, businessDate())]);
  return {
    key: "assets",
    title: t("Fixed assets", "সম্পদ রেজিস্টার"),
    from: ctx.to,
    to: ctx.to,
    summary: [
      { label: t("Cost", "খরচ"), value: register.totals.cost },
      { label: t("Written off", "অবচয়"), value: register.totals.accumulated },
      { label: t("Worth now", "বর্তমান মূল্য"), value: register.totals.bookValue },
    ],
    sections: [
      { key: "categories", title: t("By category", "ক্যাটাগরি অনুযায়ী"), columns: [col("label", "Category", "ক্যাটাগরি"), col("count", "Assets", "সংখ্যা", true), col("cost", "Cost", "খরচ", true), col("accumulated", "Written off", "অবচয়", true), col("bookValue", "Worth now", "বর্তমান মূল্য", true)], rows: register.byCategory },
      { key: "assets", title: t("Register", "রেজিস্টার"), columns: [col("code", "Code", "কোড"), col("name", "Asset", "সম্পদ"), col("purchaseDate", "Bought", "ক্রয়"), col("cost", "Cost", "খরচ", true), col("accumulated", "Written off", "অবচয়", true), col("bookValue", "Worth now", "বর্তমান মূল্য", true), col("status", "Status", "অবস্থা")], rows: register.rows },
    ],
    identities: [identity(t("Worth now = fixed assets less depreciation in the ledger", "বর্তমান মূল্য = লেজারে স্থায়ী সম্পদ − জমা অবচয়"), dec(register.totals.bookValue), netOf(totals, accounts, (account) => account.roles.includes("FIXED_ASSET") || account.roles.includes("ACCUM_DEPR")))],
  };
}

export async function trialBalanceReport(ctx: ReportCtx): Promise<ReportResult> {
  const [accounts, totals] = await Promise.all([chart(ctx.organizationId), accountTotals(ctx, null, ctx.to)]);
  const rows = accounts
    .map((account) => {
      const net = netOf(totals, [account], () => true);
      return { account, debit: net.gt(0) ? net : ZERO, credit: net.lt(0) ? net.neg() : ZERO };
    })
    .filter((row) => !row.debit.isZero() || !row.credit.isZero());
  const debit = sumOf(rows, (row) => row.debit);
  const credit = sumOf(rows, (row) => row.credit);
  return {
    key: "trial-balance",
    title: t("Trial balance", "ট্রায়াল ব্যালান্স"),
    from: ctx.to,
    to: ctx.to,
    summary: [{ label: t("Debit", "ডেবিট"), value: money(debit) }, { label: t("Credit", "ক্রেডিট"), value: money(credit) }],
    sections: [{ key: "accounts", title: t("Accounts", "অ্যাকাউন্ট"), columns: [col("code", "Code", "কোড"), col("name", "Account", "অ্যাকাউন্ট"), col("debit", "Debit", "ডেবিট", true), col("credit", "Credit", "ক্রেডিট", true)], rows: rows.map((row) => ({ code: row.account.code, name: row.account.name, debit: row.debit.isZero() ? "" : money(row.debit), credit: row.credit.isZero() ? "" : money(row.credit) })), total: { debit: money(debit), credit: money(credit) } }],
    identities: [identity(t("Debits = credits", "ডেবিট = ক্রেডিট"), debit, credit)],
  };
}

export async function balanceSheet(ctx: ReportCtx): Promise<ReportResult> {
  const [accounts, totals] = await Promise.all([chart(ctx.organizationId), accountTotals(ctx, null, ctx.to)]);
  const side = (group: string, sign: 1 | -1) =>
    accounts
      .filter((account) => account.group === group)
      .map((account) => ({ account, amount: netOf(totals, [account], () => true).mul(sign) }))
      .filter((row) => !row.amount.isZero());
  const assets = side(GROUP.ASSET, 1);
  const liabilities = side(GROUP.LIABILITY, -1);
  const equity = side(GROUP.EQUITY, -1);
  const profit = netOf(totals, accounts, (account) => account.group === GROUP.REVENUE || account.group === GROUP.COST_OF_SALES || account.group === GROUP.EXPENSE).neg();
  const table = (rows: typeof assets) => rows.map((row) => ({ code: row.account.code, name: row.account.name, amount: money(row.amount) }));
  const columns = [col("code", "Code", "কোড"), col("name", "Account", "অ্যাকাউন্ট"), col("amount", "Amount", "পরিমাণ", true)];
  const totalAssets = sumOf(assets, (row) => row.amount);
  const totalLiabilities = sumOf(liabilities, (row) => row.amount);
  const totalEquity = sumOf(equity, (row) => row.amount);
  return {
    key: "balance-sheet",
    title: t("Balance sheet", "ব্যালান্স শিট"),
    from: ctx.to,
    to: ctx.to,
    summary: [
      { label: t("Assets", "সম্পদ"), value: money(totalAssets) },
      { label: t("Liabilities", "দায়"), value: money(totalLiabilities) },
      { label: t("Equity", "মালিকানা"), value: money(totalEquity) },
      { label: t("Profit not yet closed", "চলতি লাভ"), value: money(profit) },
    ],
    sections: [
      { key: "assets", title: t("Assets", "সম্পদ"), columns, rows: table(assets), total: { amount: money(totalAssets) } },
      { key: "liabilities", title: t("Liabilities", "দায়"), columns, rows: table(liabilities), total: { amount: money(totalLiabilities) } },
      { key: "equity", title: t("Equity", "মালিকানা"), columns, rows: [...table(equity), { code: "", name: "Profit not yet closed / চলতি লাভ", amount: money(profit) }], total: { amount: money(totalEquity.plus(profit)) } },
    ],
    identities: [identity(t("Assets = liabilities + equity + profit", "সম্পদ = দায় + মালিকানা + চলতি লাভ"), totalAssets, totalLiabilities.plus(totalEquity).plus(profit))],
  };
}

export async function cashFlowReport(ctx: ReportCtx): Promise<ReportResult> {
  const [accounts, before, upTo, lines] = await Promise.all([chart(ctx.organizationId), accountTotals(ctx, null, dayBefore(ctx.from)), accountTotals(ctx, null, ctx.to), moneyLines(ctx)]);
  const money_ = accounts.filter(isMoney);
  const opening = netOf(before, money_, () => true);
  const closing = netOf(upTo, money_, () => true);
  const external = lines.filter((line) => line.docType !== "CONTRA");
  const byKind = new Map<string, { in: Prisma.Decimal; out: Prisma.Decimal }>();
  for (const line of external) {
    const kind = kindOf(line);
    const have = byKind.get(kind) ?? { in: ZERO, out: ZERO };
    byKind.set(kind, { in: have.in.plus(line.debit), out: have.out.plus(line.credit) });
  }
  const totalIn = sumOf(external, (line) => line.debit);
  const totalOut = sumOf(external, (line) => line.credit);
  return {
    key: "cash-flow",
    title: t("Cash flow", "ক্যাশ ফ্লো"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Opening (cash, bank, mobile)", "শুরু"), value: money(opening) },
      { label: t("In", "এসেছে"), value: money(totalIn) },
      { label: t("Out", "গেছে"), value: money(totalOut) },
      { label: t("Closing", "শেষ"), value: money(closing) },
    ],
    sections: [{ key: "kinds", title: t("By kind (transfers between own accounts left out)", "ধরন অনুযায়ী (নিজস্ব ট্রান্সফার বাদে)"), columns: [col("kind", "Kind", "ধরন"), col("in", "In", "এসেছে", true), col("out", "Out", "গেছে", true)], rows: [...byKind].map(([kind, value]) => ({ kind, in: money(value.in), out: money(value.out) })), total: { in: money(totalIn), out: money(totalOut) } }],
    identities: [identity(t("Opening + in - out = closing", "শুরু + এসেছে − গেছে = শেষ"), opening.plus(totalIn).minus(totalOut), closing)],
  };
}

const DOC_NAME: Record<string, string> = {
  SALE: "Sale / বিক্রি",
  SALE_RETURN: "Sale return / বিক্রি ফেরত",
  PURCHASE: "Purchase / ক্রয়",
  PURCHASE_RETURN: "Purchase return / ক্রয় ফেরত",
  CUSTOMER_PAYMENT: "Receipt / রসিদ",
  CUSTOMER_ADVANCE: "Customer advance / অগ্রিম",
  SUPPLIER_PAYMENT: "Vendor payment / Vendor পেমেন্ট",
  SUPPLIER_ADVANCE: "Vendor advance / Vendor অগ্রিম",
  EXPENSE: "Expense / খরচ",
  EXPENSE_SETTLEMENT: "Owed expense paid / বকেয়া খরচ পরিশোধ",
  CONTRA: "Transfer / ট্রান্সফার",
  SHIPMENT: "Parcel sent / পার্সেল পাঠানো",
  SHIPMENT_RETURN: "Parcel back / পার্সেল ফেরত",
  COURIER_SETTLEMENT: "Courier settlement / কুরিয়ার সেটেলমেন্ট",
  INCOME: "Other income / অন্যান্য আয়",
  CAPITAL: "Capital / মূলধন",
  LOAN: "Loan / ঋণ",
  DEPRECIATION: "Depreciation / অবচয়",
  ASSET_PURCHASE: "Asset bought / সম্পদ ক্রয়",
  ASSET_DISPOSAL: "Asset sold / সম্পদ বিক্রি",
  OPENING_STOCK: "Opening stock / ওপেনিং স্টক",
  DAMAGE: "Damage / ড্যামেজ",
  TAKE_OFF: "Take-off",
  CASH_MOVEMENT: "Cash in/out / ক্যাশ ইন-আউট",
  SHIFT_VARIANCE: "Shift difference / শিফট পার্থক্য",
  JOURNAL: "Journal / জার্নাল",
};

/** Every posted journal of the window with its lines (the day book) or one line a document (every transaction, feature 13). */
async function journalsOf(ctx: ReportCtx) {
  const journals = await prisma.journal.findMany({
    where: { organizationId: ctx.organizationId, status: "POSTED", businessDate: { gte: day(ctx.from), lte: day(ctx.to) }, ...docBranches(ctx) },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
    take: 3000,
    select: { id: true, number: true, description: true, docType: true, businessDate: true, createdAt: true, createdBy: { select: { name: true } }, lines: { select: { debit: true, credit: true, partyType: true, partyId: true, account: { select: { code: true, name: true, kind: true } } } } },
  });
  return journals;
}

export async function dayBookReport(ctx: ReportCtx): Promise<ReportResult> {
  const journals = await journalsOf(ctx);
  const rows = journals.flatMap((journal) =>
    journal.lines.map((line, index) => ({ date: index === 0 ? dateOnly(journal.businessDate) : "", entry: index === 0 ? `${journal.number ?? ""} ${journal.description ?? ""}`.trim() : "", kind: index === 0 ? (DOC_NAME[journal.docType ?? ""] ?? journal.docType ?? "") : "", account: `${line.account.code} ${line.account.name}`, debit: line.debit.isZero() ? "" : money(line.debit), credit: line.credit.isZero() ? "" : money(line.credit) })),
  );
  const debit = sumOf(journals.flatMap((journal) => journal.lines), (line) => line.debit);
  const credit = sumOf(journals.flatMap((journal) => journal.lines), (line) => line.credit);
  return {
    key: "day-book",
    title: t("Day book", "ডে-বুক"),
    from: ctx.from,
    to: ctx.to,
    summary: [{ label: t("Entries", "এন্ট্রি"), value: String(journals.length) }],
    sections: [{ key: "lines", title: t("Entries", "এন্ট্রি"), columns: [col("date", "Date", "তারিখ"), col("entry", "Entry", "এন্ট্রি"), col("kind", "Kind", "ধরন"), col("account", "Account", "অ্যাকাউন্ট"), col("debit", "Debit", "ডেবিট", true), col("credit", "Credit", "ক্রেডিট", true)], rows, total: { debit: money(debit), credit: money(credit) } }],
    identities: [identity(t("Debits = credits", "ডেবিট = ক্রেডিট"), debit, credit)],
  };
}

export async function transactionsReport(ctx: ReportCtx): Promise<ReportResult> {
  const journals = await journalsOf(ctx);
  const partyIds = [...new Set(journals.flatMap((journal) => journal.lines.flatMap((line) => (line.partyId ? [line.partyId] : []))))];
  const [customers, suppliers, couriers] = await Promise.all([
    prisma.customer.findMany({ where: { id: { in: partyIds } }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { id: { in: partyIds } }, select: { id: true, name: true } }),
    prisma.courier.findMany({ where: { id: { in: partyIds } }, select: { id: true, name: true } }),
  ]);
  const party = new Map([...customers, ...suppliers, ...couriers].map((row) => [row.id, row.name]));
  const rows = journals.map((journal) => {
    const amount = sumOf(journal.lines, (line) => line.debit);
    const moneyLine = journal.lines.find((line) => line.account.kind === "CASH" || line.account.kind === "BANK" || line.account.kind === "MOBILE");
    const who = journal.lines.find((line) => line.partyId)?.partyId;
    return {
      date: dateOnly(journal.businessDate),
      time: journal.createdAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" }),
      kind: DOC_NAME[journal.docType ?? ""] ?? journal.docType ?? "",
      number: journal.number ?? "",
      party: who ? (party.get(who) ?? "") : "",
      account: moneyLine ? moneyLine.account.name : "",
      in: moneyLine && moneyLine.debit.gt(0) ? money(moneyLine.debit) : "",
      out: moneyLine && moneyLine.credit.gt(0) ? money(moneyLine.credit) : "",
      amount: money(amount),
      what: journal.description ?? "",
      by: journal.createdBy?.name ?? "",
    };
  });
  return {
    key: "transactions",
    title: t("Every transaction", "সব লেনদেন"),
    from: ctx.from,
    to: ctx.to,
    summary: [{ label: t("Transactions", "লেনদেন"), value: String(rows.length) }],
    sections: [{ key: "lines", title: t("Transactions", "লেনদেন"), columns: [col("date", "Date", "তারিখ"), col("time", "Time", "সময়"), col("kind", "Kind", "ধরন"), col("number", "Number", "নম্বর"), col("party", "Party", "পার্টি"), col("account", "Cash/bank", "ক্যাশ/ব্যাংক"), col("in", "In", "ডেবিট", true), col("out", "Out", "ক্রেডিট", true), col("amount", "Entry total", "মোট", true), col("what", "What", "বিবরণ"), col("by", "By", "কে")], rows }],
    identities: [],
  };
}
