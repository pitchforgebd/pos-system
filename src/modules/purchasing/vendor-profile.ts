import { Prisma } from "@prisma/client";

import { decimalString } from "@/core/money";
import { partyBalances, recentPartyLines } from "@/core/parties";
import { paymentStatuses } from "@/core/payments";
import { dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";

// A vendor's page (P05 task 8): who they are, what the shop owes them, what is held with them as an advance, their bills with how much of
// each is paid, the payments made, and the ledger. The owed and advance figures are the books' (the payable and advance lines of the journal).

const ZERO = new Prisma.Decimal(0);

export async function getVendorProfile(organizationId: string, id: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id, organizationId },
    select: { id: true, name: true, phone: true, email: true, address: true, openingPayable: true, creditLimit: true, paymentTerms: true, status: true },
  });
  if (!supplier) {
    return null;
  }
  const balances = await partyBalances(prisma, { organizationId, partyType: "VENDOR", partyIds: [id] });
  const figures = balances.get(id) ?? { balance: ZERO, advance: ZERO };

  const purchases = await prisma.purchase.findMany({
    where: { organizationId, supplierId: id, status: "RECEIVED" },
    orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: { id: true, number: true, businessDate: true, receivedOn: true, supplierInvoiceNo: true, total: true, branch: { select: { name: true } } },
  });
  const status = await paymentStatuses(prisma, organizationId, "VENDOR", purchases.map((row) => ({ id: row.id, total: row.total })));
  const bills = purchases.map((row) => {
    const paid = status.get(row.id);
    return {
      id: row.id,
      number: row.number,
      businessDate: dateOnly(row.receivedOn ?? row.businessDate),
      supplierInvoiceNo: row.supplierInvoiceNo,
      branch: row.branch.name,
      total: decimalString(row.total, 2),
      owed: decimalString(paid?.owed ?? ZERO, 2),
      status: paid?.status ?? "UNPAID",
    };
  });

  const [payments, advances, accounts] = await Promise.all([
    prisma.supplierPayment.findMany({
      where: { organizationId, supplierId: id },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, number: true, businessDate: true, method: true, accountId: true, amount: true, charge: true },
    }),
    prisma.supplierAdvance.findMany({
      where: { organizationId, supplierId: id },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, number: true, businessDate: true, accountId: true, amount: true },
    }),
    prisma.account.findMany({ where: { organizationId, kind: { in: ["CASH", "BANK", "MOBILE"] } }, select: { id: true, name: true } }),
  ]);
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));

  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    paymentTerms: supplier.paymentTerms,
    status: supplier.status,
    creditLimit: supplier.creditLimit ? decimalString(supplier.creditLimit, 2) : null,
    openingPayable: decimalString(supplier.openingPayable, 2),
    /** What the shop owes the vendor (the payable lines of the journal). */
    outstanding: decimalString(figures.balance, 2),
    /** Money held with the vendor, paid ahead of a bill. */
    advance: decimalString(figures.advance, 2),
    bills,
    openBills: bills.filter((bill) => bill.owed !== "0.00"),
    payments: payments.map((row) => ({
      id: row.id,
      number: row.number,
      businessDate: dateOnly(row.businessDate),
      method: row.method,
      account: row.accountId ? (accountName.get(row.accountId) ?? "") : row.method === "ADVANCE" ? "Advance used" : "",
      amount: decimalString(row.amount, 2),
      charge: decimalString(row.charge, 2),
    })),
    advances: advances.map((row) => ({
      id: row.id,
      number: row.number,
      businessDate: dateOnly(row.businessDate),
      account: accountName.get(row.accountId) ?? "",
      amount: decimalString(row.amount, 2),
    })),
    ledger: await recentPartyLines(prisma, { organizationId, partyType: "VENDOR", partyId: id }),
  };
}

/** One payment to a vendor, for its receipt. */
export async function getSupplierPayment(organizationId: string, id: string) {
  const row = await prisma.supplierPayment.findFirst({
    where: { id, organizationId },
    include: { supplier: { select: { id: true, name: true, phone: true } } },
  });
  if (!row) {
    return null;
  }
  const [account, allocations] = await Promise.all([
    row.accountId ? prisma.account.findUnique({ where: { id: row.accountId }, select: { name: true } }) : null,
    row.journalId ? prisma.paymentAllocation.findMany({ where: { organizationId, journalId: row.journalId, billId: { not: null } }, select: { amount: true, bill: { select: { id: true, number: true } } } }) : [],
  ]);
  return {
    id: row.id,
    number: row.number,
    businessDate: dateOnly(row.businessDate),
    method: row.method,
    account: account?.name ?? (row.method === "ADVANCE" ? "Advance used" : ""),
    amount: decimalString(row.amount, 2),
    charge: decimalString(row.charge, 2),
    supplier: row.supplier,
    bills: allocations.map((entry) => ({ id: entry.bill?.id ?? "", number: entry.bill?.number ?? "", amount: decimalString(entry.amount, 2) })),
  };
}
