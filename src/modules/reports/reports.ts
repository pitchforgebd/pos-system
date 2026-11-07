import { Prisma } from "@prisma/client";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { decimalString, moneyText } from "@/core/money";
import { alertStatus } from "@/modules/inventory/stock";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const listLimit = 100;

export type ReportScope = {
  organizationId: string;
  branchId: string;
  from?: string | null;
  to?: string | null;
};

function dec(value: Prisma.Decimal | string | number | null | undefined) {
  return new Prisma.Decimal(value ?? 0);
}

export function reportWindow(scope: Pick<ReportScope, "from" | "to">) {
  const from = scope.from ?? "";
  const to = scope.to ?? "";
  if (!datePattern.test(from) || !datePattern.test(to) || from > to) {
    return null;
  }
  return {
    gte: new Date(`${from}T00:00:00.000Z`),
    lte: new Date(`${to}T00:00:00.000Z`),
  };
}

function postedJournal(scope: ReportScope) {
  return {
    status: "POSTED" as const,
    branchId: scope.branchId,
    businessDate: reportWindow(scope) ?? undefined,
  };
}

export async function salesReport(scope: ReportScope) {
  const where = {
    organizationId: scope.organizationId,
    branchId: scope.branchId,
    status: "POSTED" as const,
    businessDate: reportWindow(scope) ?? undefined,
  };
  const [sum, rows] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { total: true }, _count: true }),
    prisma.sale.findMany({
      where,
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: listLimit,
      select: {
        id: true,
        total: true,
        businessDate: true,
        customer: { select: { name: true } },
        invoice: { select: { number: true } },
      },
    }),
  ]);
  return {
    total: moneyText(dec(sum._sum.total)),
    count: sum._count,
    rows: rows.map((row) => ({
      id: row.id,
      businessDate: dateOnly(row.businessDate),
      number: row.invoice?.number ?? "Sale",
      party: row.customer?.name ?? "Walk-in",
      total: moneyText(row.total),
    })),
  };
}

export async function purchaseReport(scope: ReportScope) {
  const where = {
    organizationId: scope.organizationId,
    branchId: scope.branchId,
    status: "POSTED" as const,
    businessDate: reportWindow(scope) ?? undefined,
  };
  const [sum, rows] = await Promise.all([
    prisma.purchase.aggregate({ where, _sum: { total: true }, _count: true }),
    prisma.purchase.findMany({
      where,
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: listLimit,
      select: { id: true, number: true, total: true, businessDate: true, supplier: { select: { name: true } } },
    }),
  ]);
  return {
    total: moneyText(dec(sum._sum.total)),
    count: sum._count,
    rows: rows.map((row) => ({
      id: row.id,
      businessDate: dateOnly(row.businessDate),
      number: row.number ?? "Purchase",
      party: row.supplier.name,
      total: moneyText(row.total),
    })),
  };
}

export async function inventoryReport(scope: ReportScope) {
  const where = { organizationId: scope.organizationId, branchId: scope.branchId };
  const [count, rows] = await Promise.all([
    prisma.stockBalance.count({ where }),
    prisma.stockBalance.findMany({
      where,
      orderBy: { product: { sku: "asc" } },
      take: listLimit,
      select: {
        id: true,
        quantity: true,
        warehouse: { select: { name: true } },
        product: { select: { sku: true, name: true, reorderLevel: true } },
      },
    }),
  ]);
  return {
    count,
    rows: rows.map((row) => ({
      id: row.id,
      sku: row.product.sku,
      product: row.product.name,
      warehouse: row.warehouse.name,
      quantity: decimalString(row.quantity, 4),
      status: alertStatus(row.quantity, row.product.reorderLevel),
    })),
  };
}

export async function customerReport(organizationId: string) {
  const [count, customers, sums] = await Promise.all([
    prisma.customer.count({ where: { organizationId } }),
    prisma.customer.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      take: listLimit,
      select: { id: true, name: true },
    }),
    prisma.customerLedger.groupBy({
      by: ["customerId"],
      where: { organizationId },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const dueById = new Map(sums.map((row) => [row.customerId, dec(row._sum.debit).minus(dec(row._sum.credit))]));
  return {
    count,
    rows: customers.map((row) => ({
      id: row.id,
      name: row.name,
      due: moneyText(dueById.get(row.id) ?? new Prisma.Decimal(0)),
    })),
  };
}

export async function supplierReport(organizationId: string) {
  const [count, suppliers, sums] = await Promise.all([
    prisma.supplier.count({ where: { organizationId } }),
    prisma.supplier.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      take: listLimit,
      select: { id: true, name: true },
    }),
    prisma.supplierLedger.groupBy({
      by: ["supplierId"],
      where: { organizationId },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const dueById = new Map(sums.map((row) => [row.supplierId, dec(row._sum.credit).minus(dec(row._sum.debit))]));
  return {
    count,
    rows: suppliers.map((row) => ({
      id: row.id,
      name: row.name,
      payable: moneyText(dueById.get(row.id) ?? new Prisma.Decimal(0)),
    })),
  };
}

async function accountMovement(scope: ReportScope, code: string) {
  const account = await prisma.account.findFirst({
    where: { organizationId: scope.organizationId, code },
    select: { id: true, code: true, name: true },
  });
  if (!account) {
    return { code, debit: "0.00", credit: "0.00", count: 0, rows: [] as { id: string; businessDate: string; reference: string; debit: string; credit: string }[] };
  }
  const where = {
    organizationId: scope.organizationId,
    accountId: account.id,
    journal: postedJournal(scope),
  };
  const [sum, rows] = await Promise.all([
    prisma.journalLine.aggregate({ where, _sum: { debit: true, credit: true }, _count: true }),
    prisma.journalLine.findMany({
      where,
      orderBy: [{ journal: { businessDate: "desc" } }, { createdAt: "desc" }],
      take: listLimit,
      select: { id: true, debit: true, credit: true, journal: { select: { number: true, description: true, businessDate: true } } },
    }),
  ]);
  return {
    code: account.code,
    debit: moneyText(dec(sum._sum.debit)),
    credit: moneyText(dec(sum._sum.credit)),
    count: sum._count,
    rows: rows.map((row) => ({
      id: row.id,
      businessDate: dateOnly(row.journal.businessDate),
      reference: row.journal.number ?? row.journal.description ?? "Journal",
      debit: moneyText(row.debit),
      credit: moneyText(row.credit),
    })),
  };
}

export function cashReport(scope: ReportScope) {
  return accountMovement(scope, "1100");
}

export function bankReport(scope: ReportScope) {
  return accountMovement(scope, "1200");
}

export async function trialBalance(scope: ReportScope) {
  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: { organizationId: scope.organizationId, journal: postedJournal(scope) },
    _sum: { debit: true, credit: true },
  });
  const accounts = await prisma.account.findMany({
    where: { id: { in: sums.map((row) => row.accountId) } },
    select: { id: true, code: true, name: true },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  let debit = new Prisma.Decimal(0);
  let credit = new Prisma.Decimal(0);
  const rows = sums
    .map((row) => {
      const lineDebit = dec(row._sum.debit);
      const lineCredit = dec(row._sum.credit);
      debit = debit.plus(lineDebit);
      credit = credit.plus(lineCredit);
      const account = byId.get(row.accountId);
      return {
        id: row.accountId,
        code: account?.code ?? "",
        name: account?.name ?? "Account",
        debit: moneyText(lineDebit),
        credit: moneyText(lineCredit),
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code));
  return { debit: moneyText(debit), credit: moneyText(credit), balanced: debit.eq(credit), rows };
}

export async function dayBook(scope: ReportScope) {
  const where = { organizationId: scope.organizationId, journal: postedJournal(scope) };
  const [sum, rows] = await Promise.all([
    prisma.journalLine.aggregate({ where, _sum: { debit: true, credit: true }, _count: true }),
    prisma.journalLine.findMany({
      where,
      orderBy: [{ journal: { businessDate: "desc" } }, { createdAt: "desc" }],
      take: listLimit,
      select: {
        id: true,
        debit: true,
        credit: true,
        account: { select: { code: true, name: true } },
        journal: { select: { number: true, description: true, businessDate: true } },
      },
    }),
  ]);
  const debit = dec(sum._sum.debit);
  const credit = dec(sum._sum.credit);
  return {
    debit: moneyText(debit),
    credit: moneyText(credit),
    balanced: debit.eq(credit),
    count: sum._count,
    rows: rows.map((row) => ({
      id: row.id,
      businessDate: dateOnly(row.journal.businessDate),
      reference: row.journal.number ?? row.journal.description ?? "Journal",
      account: `${row.account.code} ${row.account.name}`,
      debit: moneyText(row.debit),
      credit: moneyText(row.credit),
    })),
  };
}

export async function profitAndLoss(scope: ReportScope) {
  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: { organizationId: scope.organizationId, journal: postedJournal(scope) },
    _sum: { debit: true, credit: true },
  });
  const accounts = await prisma.account.findMany({
    where: { id: { in: sums.map((row) => row.accountId) } },
    select: { id: true, code: true, name: true, group: { select: { code: true } } },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  let revenue = new Prisma.Decimal(0);
  let cost = new Prisma.Decimal(0);
  let expenses = new Prisma.Decimal(0);
  const rows = [];
  for (const row of sums) {
    const account = byId.get(row.accountId);
    const group = account?.group.code;
    const amount = group === "4000" ? dec(row._sum.credit).minus(dec(row._sum.debit)) : dec(row._sum.debit).minus(dec(row._sum.credit));
    if (group === "4000") {
      revenue = revenue.plus(amount);
    } else if (group === "5000") {
      cost = cost.plus(amount);
    } else if (group === "6000") {
      expenses = expenses.plus(amount);
    } else {
      continue;
    }
    rows.push({ id: row.accountId, code: account?.code ?? "", name: account?.name ?? "Account", group, amount: moneyText(amount) });
  }
  rows.sort((left, right) => left.code.localeCompare(right.code));
  const gross = revenue.minus(cost);
  return {
    revenue: moneyText(revenue),
    cost: moneyText(cost),
    gross: moneyText(gross),
    expenses: moneyText(expenses),
    net: moneyText(gross.minus(expenses)),
    rows,
  };
}

export async function salesByProduct(scope: ReportScope) {
  const grouped = await prisma.saleItem.groupBy({
    by: ["productId"],
    where: {
      organizationId: scope.organizationId,
      sale: {
        organizationId: scope.organizationId,
        branchId: scope.branchId,
        status: "POSTED",
        businessDate: reportWindow(scope) ?? undefined,
      },
    },
    _sum: { quantity: true, lineTotal: true },
  });
  const products = await prisma.product.findMany({
    where: { organizationId: scope.organizationId, id: { in: grouped.map((row) => row.productId) } },
    select: { id: true, sku: true, name: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const returnLines = await prisma.saleReturnItem.findMany({
    where: {
      organizationId: scope.organizationId,
      saleReturn: {
        organizationId: scope.organizationId,
        branchId: scope.branchId,
        status: "POSTED",
        businessDate: reportWindow(scope) ?? undefined,
      },
    },
    select: { quantity: true, saleItem: { select: { productId: true, unitPrice: true, lineTotal: true, quantity: true } } },
  });
  const returnedQty = new Map<string, Prisma.Decimal>();
  const returnedAmount = new Map<string, Prisma.Decimal>();
  for (const line of returnLines) {
    const productId = line.saleItem.productId;
    const sourceQty = dec(line.saleItem.quantity);
    const share = sourceQty.gt(0) ? dec(line.quantity).div(sourceQty).mul(dec(line.saleItem.lineTotal)) : dec(0);
    returnedQty.set(productId, dec(returnedQty.get(productId)).plus(line.quantity));
    returnedAmount.set(productId, dec(returnedAmount.get(productId)).plus(share));
  }
  const rows = grouped
    .map((row) => {
      const product = byId.get(row.productId);
      const total = dec(row._sum.lineTotal).minus(returnedAmount.get(row.productId) ?? 0);
      const quantity = dec(row._sum.quantity).minus(returnedQty.get(row.productId) ?? 0);
      return {
        id: row.productId,
        sku: product?.sku ?? "",
        name: product?.name ?? "Product",
        quantity: decimalString(quantity, 4),
        total,
      };
    })
    .sort((left, right) => right.total.comparedTo(left.total))
    .slice(0, listLimit)
    .map((row) => ({ ...row, total: moneyText(row.total) }));
  return { count: grouped.length, rows };
}

export async function paymentMethodReport(scope: ReportScope) {
  const grouped = await prisma.salePayment.groupBy({
    by: ["method"],
    where: {
      organizationId: scope.organizationId,
      sale: {
        organizationId: scope.organizationId,
        branchId: scope.branchId,
        status: "POSTED",
        businessDate: reportWindow(scope) ?? undefined,
      },
    },
    _sum: { amount: true },
    _count: true,
  });
  return {
    rows: grouped.map((row) => ({
      id: row.method,
      method: row.method,
      count: row._count,
      amount: moneyText(dec(row._sum.amount)),
    })),
  };
}

export async function dueSaleReport(scope: ReportScope) {
  const rows = await prisma.sale.findMany({
    where: {
      organizationId: scope.organizationId,
      branchId: scope.branchId,
      status: "POSTED",
      businessDate: reportWindow(scope) ?? undefined,
    },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: listLimit,
    select: {
      id: true,
      total: true,
      businessDate: true,
      customer: { select: { name: true } },
      invoice: { select: { number: true } },
      payments: { select: { method: true, amount: true } },
      returns: { where: { status: "POSTED" }, select: { total: true } },
    },
  });
  const dueRows = rows.flatMap((row) => {
    const paid = row.payments.reduce((sum, payment) => sum.plus(payment.amount), dec(0));
    const returned = row.returns.reduce((sum, item) => sum.plus(item.total), dec(0));
    const due = dec(row.total).minus(paid).minus(returned);
    if (due.lte(0)) {
      return [];
    }
    return [{
      id: row.id,
      businessDate: dateOnly(row.businessDate),
      number: row.invoice?.number ?? "Sale",
      party: row.customer?.name ?? "Walk-in",
      total: moneyText(dec(row.total)),
      cash: moneyText(paid),
      due: moneyText(due),
    }];
  });
  return { shown: rows.length, rows: dueRows };
}

export async function branchName(organizationId: string, branchId: string) {
  const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId }, select: { name: true } });
  return branch?.name ?? "this branch";
}

export async function reportOverview(organizationId: string) {
  const [cards, pointRows, messages] = await Promise.all([
    prisma.loyaltyCard.count({ where: { organizationId } }),
    prisma.loyaltyTransaction.count({ where: { organizationId } }),
    prisma.smsMessage.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
  ]);
  const countOf = (status: string) => messages.find((row) => row.status === status)?._count ?? 0;
  return {
    loyaltyCards: cards,
    loyaltyPointRows: pointRows,
    smsSent: countOf("SENT"),
    smsFailed: countOf("FAILED"),
  };
}
