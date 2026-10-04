import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import { decimalString } from "@/modules/inventory/money";

export type WingSummary = {
  totalSales: string;
  instantPaid: string;
  totalDueSale: string;
  dueReceived: string;
  totalReturn: string;
  totalExpense: string;
  previousReturn: string;
  stockAlertQty: string;
  totalPayment: string;
  dueReceivedAlert: string;
  netProfit: string;
  totalPurchases: string;
  walletUsedBalance: string;
  supplierAdvanceBalance: string;
  customerAdvanceBalance: string;
  weekSales: string;
  weekDays: { date: string; total: string }[];
  sell: ReportTiles;
  products: ReportTiles;
  suppliers: ReportTiles;
  dealers: ReportTiles;
};

export type ReportTiles = Record<string, string>;

function money(value: Prisma.Decimal | number | null | undefined) {
  return decimalString(value ?? 0, 2);
}

function branchFilter(branchId: string | null, branchIds: string[]) {
  if (branchId) {
    return { branchId };
  }
  return { branchId: { in: branchIds } };
}

async function netProfit(organizationId: string, branchId: string | null, branchIds: string[], occurredOn: Date) {
  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      organizationId,
      journal: { status: "POSTED", occurredOn, ...branchFilter(branchId, branchIds) },
    },
    _sum: { debit: true, credit: true },
  });
  if (sums.length === 0) {
    return money(0);
  }
  const accounts = await prisma.account.findMany({
    where: { id: { in: sums.map((row) => row.accountId) } },
    select: { id: true, group: { select: { code: true } } },
  });
  const groups = new Map(accounts.map((account) => [account.id, account.group.code]));
  let revenue = new Prisma.Decimal(0);
  let cost = new Prisma.Decimal(0);
  let expenses = new Prisma.Decimal(0);
  for (const row of sums) {
    const group = groups.get(row.accountId);
    const debit = new Prisma.Decimal(row._sum.debit ?? 0);
    const credit = new Prisma.Decimal(row._sum.credit ?? 0);
    if (group === "4000") {
      revenue = revenue.plus(credit.minus(debit));
    } else if (group === "5000") {
      cost = cost.plus(debit.minus(credit));
    } else if (group === "6000") {
      expenses = expenses.plus(debit.minus(credit));
    }
  }
  return money(revenue.minus(cost).minus(expenses));
}

async function stockAlertCount(organizationId: string, branchId: string | null, branchIds: string[]) {
  const ids = branchId ? [branchId] : branchIds;
  if (ids.length === 0) {
    return 0;
  }
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM stock_balances sb
    INNER JOIN products p ON p.id = sb.productId AND p.organizationId = sb.organizationId
    WHERE sb.organizationId = ${organizationId}
      AND sb.branchId IN (${Prisma.join(ids)})
      AND p.deletedAt IS NULL
      AND p.reorderLevel > 0
      AND sb.quantity <= p.reorderLevel
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function wingSummary(
  organizationId: string,
  branchId: string | null,
  branchIds: string[],
  day: string,
): Promise<WingSummary> {
  const empty: WingSummary = {
    totalSales: "0.00",
    instantPaid: "0.00",
    totalDueSale: "0.00",
    dueReceived: "0.00",
    totalReturn: "0.00",
    totalExpense: "0.00",
    previousReturn: "0.00",
    stockAlertQty: "0",
    totalPayment: "0.00",
    dueReceivedAlert: "0",
    netProfit: "0.00",
    totalPurchases: "0.00",
    walletUsedBalance: "0.00",
    supplierAdvanceBalance: "0.00",
    customerAdvanceBalance: "0.00",
    weekSales: "0.00",
    weekDays: [],
    sell: {},
    products: {},
    suppliers: {},
    dealers: {},
  };
  const scoped = branchId ? [branchId] : branchIds;
  if (scoped.length === 0) {
    return empty;
  }
  const occurredOn = new Date(`${day}T00:00:00.000Z`);
  const weekStart = new Date(occurredOn);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const posted = { organizationId, status: "POSTED" as const, occurredOn, ...branchFilter(branchId, branchIds) };
  const [
    sales,
    cash,
    returns,
    previous,
    purchases,
    expenses,
    duePayments,
    supplierPayments,
    advances,
    wallet,
    alerts,
    dueAlerts,
    week,
    weekRows,
    net,
    boards,
  ] = await Promise.all([
    prisma.sale.aggregate({ where: posted, _sum: { total: true } }),
    prisma.salePayment.aggregate({
      where: { organizationId, method: "CASH", sale: posted },
      _sum: { amount: true },
    }),
    prisma.saleReturn.aggregate({ where: posted, _sum: { total: true } }),
    prisma.saleReturn.aggregate({
      where: { ...posted, sale: { occurredOn: { lt: occurredOn } } },
      _sum: { total: true },
    }),
    prisma.purchase.aggregate({ where: posted, _sum: { total: true } }),
    prisma.expense.aggregate({
      where: { organizationId, occurredOn, ...branchFilter(branchId, branchIds) },
      _sum: { amount: true },
    }),
    prisma.customerPayment.aggregate({
      where: { organizationId, occurredOn, ...branchFilter(branchId, branchIds) },
      _sum: { amount: true },
    }),
    prisma.supplierPayment.aggregate({
      where: { organizationId, occurredOn, ...branchFilter(branchId, branchIds) },
      _sum: { amount: true },
    }),
    prisma.customerAdvance.aggregate({
      where: { organizationId, ...branchFilter(branchId, branchIds) },
      _sum: { amount: true },
    }),
    prisma.salePayment.aggregate({
      where: { organizationId, method: "WALLET", sale: posted },
      _sum: { amount: true },
    }),
    stockAlertCount(organizationId, branchId, branchIds),
    prisma.installment.count({
      where: {
        organizationId,
        status: "OPEN",
        dueOn: occurredOn,
        ...(branchId || branchIds.length > 0 ? { invoice: branchFilter(branchId, branchIds) } : {}),
      },
    }),
    prisma.sale.aggregate({
      where: {
        organizationId,
        status: "POSTED",
        occurredOn: { gte: weekStart, lte: occurredOn },
        ...branchFilter(branchId, branchIds),
      },
      _sum: { total: true },
    }),
    prisma.sale.groupBy({
      by: ["occurredOn"],
      where: {
        organizationId,
        status: "POSTED",
        occurredOn: { gte: weekStart, lte: occurredOn },
        ...branchFilter(branchId, branchIds),
      },
      _sum: { total: true },
    }),
    netProfit(organizationId, branchId, branchIds, occurredOn),
    reportBoards(organizationId, branchId, branchIds, occurredOn),
  ]);
  const salesTotal = new Prisma.Decimal(sales._sum.total ?? 0);
  const cashTotal = new Prisma.Decimal(cash._sum.amount ?? 0);
  const dueSale = salesTotal.minus(cashTotal);
  return {
    totalSales: money(salesTotal),
    instantPaid: money(cashTotal),
    totalDueSale: money(dueSale.lt(0) ? new Prisma.Decimal(0) : dueSale),
    dueReceived: money(duePayments._sum.amount),
    totalReturn: money(returns._sum.total),
    totalExpense: money(expenses._sum.amount),
    previousReturn: money(previous._sum.total),
    stockAlertQty: String(alerts),
    totalPayment: money(supplierPayments._sum.amount),
    dueReceivedAlert: String(dueAlerts),
    netProfit: net,
    totalPurchases: money(purchases._sum.total),
    walletUsedBalance: money(wallet._sum.amount),
    supplierAdvanceBalance: boards.supplierAdvance,
    customerAdvanceBalance: money(advances._sum.amount),
    weekSales: money(week._sum.total),
    weekDays: weekList(weekStart, occurredOn, weekRows),
    sell: boards.sell,
    products: boards.products,
    suppliers: boards.suppliers,
    dealers: boards.dealers,
  };
}

function weekList(
  start: Date,
  end: Date,
  rows: Array<{ occurredOn: Date; _sum: { total: Prisma.Decimal | null } }>,
) {
  const totals = new Map(rows.map((row) => [row.occurredOn.toISOString().slice(0, 10), new Prisma.Decimal(row._sum.total ?? 0)]));
  const days: { date: string; total: string }[] = [];
  for (let cursor = new Date(end); cursor >= start; cursor = new Date(cursor.getTime() - 86_400_000)) {
    const key = cursor.toISOString().slice(0, 10);
    days.push({ date: dayLabel(key), total: money(totals.get(key) ?? 0) });
  }
  return days;
}

function dayLabel(iso: string) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [year, month, day] = iso.split("-");
  return `${day} ${months[Number(month) - 1]} ${year}`;
}

async function reportBoards(organizationId: string, branchId: string | null, branchIds: string[], day: Date) {
  const scope = branchFilter(branchId, branchIds);
  const ids = branchId ? [branchId] : branchIds;
  const monthStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const posted = { organizationId, status: "POSTED" as const, ...scope };
  const [
    sales,
    monthSales,
    yearSales,
    returns,
    monthReturns,
    yearReturns,
    collections,
    dueCollections,
    customerCount,
    customerLines,
    openingLines,
    dealers,
    supplierCount,
    supplierLines,
    productCount,
    stock,
    openingStock,
    cash,
    bank,
  ] = await Promise.all([
    prisma.sale.aggregate({ where: posted, _sum: { total: true } }),
    prisma.sale.aggregate({ where: { ...posted, occurredOn: { gte: monthStart, lte: day } }, _sum: { total: true } }),
    prisma.sale.aggregate({ where: { ...posted, occurredOn: { gte: yearStart, lte: day } }, _sum: { total: true } }),
    prisma.saleReturn.aggregate({ where: posted, _sum: { total: true } }),
    prisma.saleReturn.aggregate({ where: { ...posted, occurredOn: { gte: monthStart, lte: day } }, _sum: { total: true } }),
    prisma.saleReturn.aggregate({ where: { ...posted, occurredOn: { gte: yearStart, lte: day } }, _sum: { total: true } }),
    prisma.salePayment.aggregate({
      where: { organizationId, method: { in: ["CASH", "BANK", "CARD"] }, sale: posted },
      _sum: { amount: true },
    }),
    prisma.customerPayment.aggregate({ where: { organizationId, ...scope }, _sum: { amount: true } }),
    prisma.customer.count({ where: { organizationId } }),
    prisma.customerLedger.groupBy({
      by: ["customerId"],
      where: { organizationId, ...scope },
      _sum: { debit: true, credit: true },
    }),
    prisma.customerLedger.aggregate({
      where: { organizationId, entryType: "OPENING", ...scope },
      _sum: { debit: true, credit: true },
    }),
    prisma.customer.findMany({
      where: { organizationId, customerType: { name: "Dealer" } },
      select: { id: true },
    }),
    prisma.supplier.count({ where: { organizationId } }),
    prisma.supplierLedger.groupBy({
      by: ["supplierId"],
      where: { organizationId, ...scope },
      _sum: { debit: true, credit: true },
    }),
    prisma.product.count({ where: { organizationId, deletedAt: null } }),
    prisma.$queryRaw<Array<{ godown: bigint; stockValue: Prisma.Decimal | null }>>`
      SELECT COUNT(DISTINCT CASE WHEN sb.quantity > 0 THEN sb.productId END) AS godown,
             COALESCE(SUM(sb.quantity * p.sellingPrice), 0) AS stockValue
      FROM stock_balances sb
      INNER JOIN products p ON p.id = sb.productId AND p.organizationId = sb.organizationId
      WHERE sb.organizationId = ${organizationId}
        AND sb.branchId IN (${Prisma.join(ids)})
        AND p.deletedAt IS NULL
    `,
    prisma.$queryRaw<Array<{ value: Prisma.Decimal | null }>>`
      SELECT COALESCE(SUM(quantity * unitCost), 0) AS value
      FROM stock_ledgers
      WHERE organizationId = ${organizationId}
        AND branchId IN (${Prisma.join(ids)})
        AND movementType = 'OPENING'
        AND direction = 'IN'
        AND unitCost IS NOT NULL
    `,
    bookBalance(organizationId, branchId, branchIds, "1100"),
    bookBalance(organizationId, branchId, branchIds, "12"),
  ]);
  let dueCustomers = 0;
  let customersDue = new Prisma.Decimal(0);
  const dueByCustomer = new Map<string, Prisma.Decimal>();
  for (const row of customerLines) {
    const balance = new Prisma.Decimal(row._sum.debit ?? 0).minus(row._sum.credit ?? 0);
    dueByCustomer.set(row.customerId, balance);
    if (balance.gt(0)) {
      dueCustomers += 1;
      customersDue = customersDue.plus(balance);
    }
  }
  const dealerIds = new Set(dealers.map((dealer) => dealer.id));
  let dueDealers = 0;
  let dealersDue = new Prisma.Decimal(0);
  for (const [id, balance] of dueByCustomer) {
    if (dealerIds.has(id) && balance.gt(0)) {
      dueDealers += 1;
      dealersDue = dealersDue.plus(balance);
    }
  }
  let dueSuppliers = 0;
  let suppliersDue = new Prisma.Decimal(0);
  let supplierAdvance = new Prisma.Decimal(0);
  for (const row of supplierLines) {
    const payable = new Prisma.Decimal(row._sum.credit ?? 0).minus(row._sum.debit ?? 0);
    if (payable.gt(0)) {
      dueSuppliers += 1;
      suppliersDue = suppliersDue.plus(payable);
    } else if (payable.lt(0)) {
      supplierAdvance = supplierAdvance.plus(payable.neg());
    }
  }
  const openingDue = new Prisma.Decimal(openingLines._sum.debit ?? 0).minus(openingLines._sum.credit ?? 0);
  return {
    supplierAdvance: money(supplierAdvance),
    sell: {
      totalSales: money(sales._sum.total),
      totalCollections: money(new Prisma.Decimal(collections._sum.amount ?? 0).plus(dueCollections._sum.amount ?? 0)),
      salesDue: money(customersDue),
      monthSales: money(monthSales._sum.total),
      yearSales: money(yearSales._sum.total),
      totalReturn: money(returns._sum.total),
      monthReturn: money(monthReturns._sum.total),
      yearReturn: money(yearReturns._sum.total),
      totalCustomers: String(customerCount),
      dueCustomers: String(dueCustomers),
      customersDue: money(customersDue),
      openingDue: money(openingDue),
    },
    products: {
      totalProducts: String(productCount),
      godownProducts: String(Number(stock[0]?.godown ?? 0)),
      stockValue: money(stock[0]?.stockValue),
      openingStockValue: money(openingStock[0]?.value),
      cashInHand: money(cash),
      cashAtBank: money(bank),
    },
    suppliers: {
      totalSuppliers: String(supplierCount),
      dueSuppliers: String(dueSuppliers),
      suppliersDue: money(suppliersDue),
    },
    dealers: {
      totalDealers: String(dealers.length),
      dueDealers: String(dueDealers),
      dealersDue: money(dealersDue),
    },
  };
}

async function bookBalance(organizationId: string, branchId: string | null, branchIds: string[], code: "1100" | "12") {
  const accounts = await prisma.account.findMany({
    where: { organizationId, status: "ACTIVE", ...(code === "1100" ? { code: "1100" } : { code: { startsWith: "12" } }) },
    select: { id: true },
  });
  if (accounts.length === 0) {
    return new Prisma.Decimal(0);
  }
  const sums = await prisma.journalLine.aggregate({
    where: {
      organizationId,
      accountId: { in: accounts.map((account) => account.id) },
      journal: { status: "POSTED", ...branchFilter(branchId, branchIds) },
    },
    _sum: { debit: true, credit: true },
  });
  return new Prisma.Decimal(sums._sum.debit ?? 0).minus(sums._sum.credit ?? 0);
}
