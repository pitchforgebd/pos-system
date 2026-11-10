import { Prisma } from "@prisma/client";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { GROUP } from "@/core/ledger/groups";
import { partyBalancesOf } from "@/core/parties";
import { moneyText } from "@/core/money";

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

function branchFilter(branchId: string | null, branchIds: string[]) {
  if (branchId) {
    return { branchId };
  }
  return { branchId: { in: branchIds } };
}

async function netProfit(organizationId: string, branchId: string | null, branchIds: string[], businessDate: Date) {
  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      organizationId,
      journal: { status: "POSTED", businessDate, ...branchFilter(branchId, branchIds) },
    },
    _sum: { debit: true, credit: true },
  });
  if (sums.length === 0) {
    return moneyText(0);
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
    if (group === GROUP.REVENUE) {
      revenue = revenue.plus(credit.minus(debit));
    } else if (group === GROUP.COST_OF_SALES) {
      cost = cost.plus(debit.minus(credit));
    } else if (group === GROUP.EXPENSE) {
      expenses = expenses.plus(debit.minus(credit));
    }
  }
  return moneyText(revenue.minus(cost).minus(expenses));
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
  const businessDate = new Date(`${day}T00:00:00.000Z`);
  const weekStart = new Date(businessDate);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const posted = { organizationId, status: "POSTED" as const, businessDate, ...branchFilter(branchId, branchIds) };
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
      where: { ...posted, sale: { businessDate: { lt: businessDate } } },
      _sum: { total: true },
    }),
    prisma.purchase.aggregate({ where: posted, _sum: { total: true } }),
    prisma.expense.aggregate({
      where: { organizationId, businessDate, ...branchFilter(branchId, branchIds) },
      _sum: { amount: true },
    }),
    prisma.customerPayment.aggregate({
      where: { organizationId, businessDate, ...branchFilter(branchId, branchIds) },
      _sum: { amount: true },
    }),
    prisma.supplierPayment.aggregate({
      where: { organizationId, businessDate, ...branchFilter(branchId, branchIds) },
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
        dueOn: businessDate,
        ...(branchId || branchIds.length > 0 ? { invoice: branchFilter(branchId, branchIds) } : {}),
      },
    }),
    prisma.sale.aggregate({
      where: {
        organizationId,
        status: "POSTED",
        businessDate: { gte: weekStart, lte: businessDate },
        ...branchFilter(branchId, branchIds),
      },
      _sum: { total: true },
    }),
    prisma.sale.groupBy({
      by: ["businessDate"],
      where: {
        organizationId,
        status: "POSTED",
        businessDate: { gte: weekStart, lte: businessDate },
        ...branchFilter(branchId, branchIds),
      },
      _sum: { total: true },
    }),
    netProfit(organizationId, branchId, branchIds, businessDate),
    reportBoards(organizationId, branchId, branchIds, businessDate),
  ]);
  const salesTotal = new Prisma.Decimal(sales._sum.total ?? 0);
  const cashTotal = new Prisma.Decimal(cash._sum.amount ?? 0);
  const dueSale = salesTotal.minus(cashTotal);
  return {
    totalSales: moneyText(salesTotal),
    instantPaid: moneyText(cashTotal),
    totalDueSale: moneyText(dueSale.lt(0) ? new Prisma.Decimal(0) : dueSale),
    dueReceived: moneyText(duePayments._sum.amount),
    totalReturn: moneyText(returns._sum.total),
    totalExpense: moneyText(expenses._sum.amount),
    previousReturn: moneyText(previous._sum.total),
    stockAlertQty: String(alerts),
    totalPayment: moneyText(supplierPayments._sum.amount),
    dueReceivedAlert: String(dueAlerts),
    netProfit: net,
    totalPurchases: moneyText(purchases._sum.total),
    walletUsedBalance: moneyText(wallet._sum.amount),
    supplierAdvanceBalance: boards.supplierAdvance,
    customerAdvanceBalance: moneyText(advances._sum.amount),
    weekSales: moneyText(week._sum.total),
    weekDays: weekList(weekStart, businessDate, weekRows),
    sell: boards.sell,
    products: boards.products,
    suppliers: boards.suppliers,
    dealers: boards.dealers,
  };
}

function weekList(
  start: Date,
  end: Date,
  rows: Array<{ businessDate: Date; _sum: { total: Prisma.Decimal | null } }>,
) {
  const totals = new Map(rows.map((row) => [dateOnly(row.businessDate), new Prisma.Decimal(row._sum.total ?? 0)]));
  const days: { date: string; total: string }[] = [];
  for (let cursor = new Date(end); cursor >= start; cursor = new Date(cursor.getTime() - 86_400_000)) {
    const key = dateOnly(cursor);
    days.push({ date: dayLabel(key), total: moneyText(totals.get(key) ?? 0) });
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
    prisma.sale.aggregate({ where: { ...posted, businessDate: { gte: monthStart, lte: day } }, _sum: { total: true } }),
    prisma.sale.aggregate({ where: { ...posted, businessDate: { gte: yearStart, lte: day } }, _sum: { total: true } }),
    prisma.saleReturn.aggregate({ where: posted, _sum: { total: true } }),
    prisma.saleReturn.aggregate({ where: { ...posted, businessDate: { gte: monthStart, lte: day } }, _sum: { total: true } }),
    prisma.saleReturn.aggregate({ where: { ...posted, businessDate: { gte: yearStart, lte: day } }, _sum: { total: true } }),
    prisma.salePayment.aggregate({
      where: { organizationId, method: { in: ["CASH", "BANK", "CARD"] }, sale: posted },
      _sum: { amount: true },
    }),
    prisma.customerPayment.aggregate({ where: { organizationId, ...scope }, _sum: { amount: true } }),
    prisma.customer.count({ where: { organizationId } }),
    partyBalancesOf(prisma, { organizationId, partyType: "CUSTOMER", branchIds: ids }),
    prisma.$queryRaw<Array<{ debit: Prisma.Decimal | null; credit: Prisma.Decimal | null }>>`
      SELECT SUM(l.debit) AS debit, SUM(l.credit) AS credit
      FROM journal_lines l
      JOIN journals j ON j.id = l.journalId
      JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = 'AR'
      WHERE l.organizationId = ${organizationId} AND l.branchId IN (${Prisma.join(ids)}) AND j.docType = 'CUSTOMER_OPENING'
    `,
    prisma.customer.findMany({
      where: { organizationId, customerType: { name: "Dealer" } },
      select: { id: true },
    }),
    prisma.supplier.count({ where: { organizationId } }),
    partyBalancesOf(prisma, { organizationId, partyType: "VENDOR", branchIds: ids }),
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
    bookBalance(organizationId, branchId, branchIds, ["CASH"]),
    bookBalance(organizationId, branchId, branchIds, ["BANK", "MOBILE"]),
  ]);
  let dueCustomers = 0;
  let customersDue = new Prisma.Decimal(0);
  const dueByCustomer = new Map<string, Prisma.Decimal>();
  for (const [customerId, row] of customerLines) {
    const balance = row.balance;
    dueByCustomer.set(customerId, balance);
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
  for (const [, row] of supplierLines) {
    if (row.balance.gt(0)) {
      dueSuppliers += 1;
      suppliersDue = suppliersDue.plus(row.balance);
    }
    // money paid ahead to the vendor (their advance), as before shown as the supplier advance
    supplierAdvance = supplierAdvance.plus(row.advance);
  }
  const openingDue = new Prisma.Decimal(openingLines[0]?.debit ?? 0).minus(openingLines[0]?.credit ?? 0);
  return {
    supplierAdvance: moneyText(supplierAdvance),
    sell: {
      totalSales: moneyText(sales._sum.total),
      totalCollections: moneyText(new Prisma.Decimal(collections._sum.amount ?? 0).plus(dueCollections._sum.amount ?? 0)),
      salesDue: moneyText(customersDue),
      monthSales: moneyText(monthSales._sum.total),
      yearSales: moneyText(yearSales._sum.total),
      totalReturn: moneyText(returns._sum.total),
      monthReturn: moneyText(monthReturns._sum.total),
      yearReturn: moneyText(yearReturns._sum.total),
      totalCustomers: String(customerCount),
      dueCustomers: String(dueCustomers),
      customersDue: moneyText(customersDue),
      openingDue: moneyText(openingDue),
    },
    products: {
      totalProducts: String(productCount),
      godownProducts: String(Number(stock[0]?.godown ?? 0)),
      stockValue: moneyText(stock[0]?.stockValue),
      openingStockValue: moneyText(openingStock[0]?.value),
      cashInHand: moneyText(cash),
      cashAtBank: moneyText(bank),
    },
    suppliers: {
      totalSuppliers: String(supplierCount),
      dueSuppliers: String(dueSuppliers),
      suppliersDue: moneyText(suppliersDue),
    },
    dealers: {
      totalDealers: String(dealers.length),
      dueDealers: String(dueDealers),
      dealersDue: moneyText(dealersDue),
    },
  };
}

async function bookBalance(organizationId: string, branchId: string | null, branchIds: string[], kinds: ("CASH" | "BANK" | "MOBILE")[]) {
  const accounts = await prisma.account.findMany({
    where: { organizationId, status: "ACTIVE", kind: { in: kinds } },
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
