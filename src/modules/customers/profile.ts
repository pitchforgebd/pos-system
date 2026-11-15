import { Prisma } from "@prisma/client";

import { decimalString } from "@/core/money";
import { partyBalances, partyStatement, recentPartyLines } from "@/core/parties";
import { paymentStatuses } from "@/core/payments";
import { dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { placeLabel } from "@/modules/parties/profile";

// A customer's page (P10 task 5, 05 "customer profile"): who they are and where, what they bought in all and when last, what they owe and what is
// held for them, their invoices with how much of each is paid, returns, orders, the SMS they were sent, and the ledger. Money figures are the books'.

const ZERO = new Prisma.Decimal(0);
const text = (value: Prisma.Decimal | null | undefined) => decimalString(value ?? ZERO, 2);

export async function getCustomerProfile(organizationId: string, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { id, organizationId },
    include: { customerType: { select: { name: true } } },
  });
  if (!customer) {
    return null;
  }
  const [balances, totals, last, sales, returns, orders, messages, ledger, place] = await Promise.all([
    partyBalances(prisma, { organizationId, partyType: "CUSTOMER", partyIds: [id] }),
    prisma.sale.aggregate({ where: { organizationId, customerId: id, status: "POSTED" }, _sum: { total: true }, _count: { _all: true } }),
    prisma.sale.findFirst({ where: { organizationId, customerId: id, status: "POSTED" }, orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }], select: { businessDate: true } }),
    prisma.sale.findMany({
      where: { organizationId, customerId: id, status: "POSTED" },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, total: true, businessDate: true, invoice: { select: { number: true } }, branch: { select: { name: true } } },
    }),
    prisma.saleReturn.findMany({
      where: { organizationId, status: "POSTED", sale: { customerId: id } },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, number: true, businessDate: true, total: true, saleId: true },
    }),
    prisma.salesOrder.findMany({
      where: { organizationId, customerId: id },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, number: true, quotationNumber: true, isQuotation: true, status: true, businessDate: true, total: true },
    }),
    prisma.smsMessage.findMany({
      where: { organizationId, OR: [{ customerId: id }, ...(customer.phone ? [{ recipient: customer.phone, customerId: null }] : [])] },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, body: true, status: true, createdAt: true, sentAt: true, campaign: { select: { name: true } } },
    }),
    recentPartyLines(prisma, { organizationId, partyType: "CUSTOMER", partyId: id }),
    placeLabel(customer.districtId, customer.upazilaId),
  ]);
  const own = balances.get(id) ?? { balance: ZERO, advance: ZERO };
  const returned = returns.reduce((sum, row) => sum.plus(row.total), ZERO);
  const status = await paymentStatuses(prisma, organizationId, "CUSTOMER", sales.map((row) => ({ id: row.id, total: row.total })));
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    businessName: customer.businessName,
    phone: customer.phone,
    altPhone: customer.altPhone,
    email: customer.email,
    address: customer.address,
    nid: customer.nid,
    place,
    districtId: customer.districtId,
    upazilaId: customer.upazilaId,
    customerTypeId: customer.customerTypeId,
    type: customer.customerType?.name ?? null,
    tags: customer.tags,
    smsOptOut: customer.smsOptOut,
    paymentDays: customer.paymentDays,
    paymentTerms: customer.paymentTerms,
    creditLimit: customer.creditLimit ? text(customer.creditLimit) : null,
    openingBalance: text(customer.openingBalance),
    status: customer.status,
    isSystem: customer.isSystem,
    summary: {
      invoices: totals._count._all,
      bought: text(totals._sum.total),
      returned: text(returned),
      lastPurchase: last ? dateOnly(last.businessDate) : null,
      /** What they owe (the receivable lines of the journal). */
      due: text(own.balance),
      /** What is held for them (their wallet). */
      advance: text(own.advance),
    },
    invoices: sales.map((row) => {
      const paid = status.get(row.id);
      return { id: row.id, number: row.invoice?.number ?? null, businessDate: dateOnly(row.businessDate), branch: row.branch.name, total: text(row.total), owed: text(paid?.owed), status: paid?.status ?? "UNPAID" };
    }),
    returns: returns.map((row) => ({ id: row.id, number: row.number, businessDate: dateOnly(row.businessDate), total: text(row.total), saleId: row.saleId })),
    orders: orders.map((row) => ({ id: row.id, number: row.isQuotation ? row.quotationNumber : row.number, quotation: row.isQuotation, status: row.status, businessDate: dateOnly(row.businessDate), total: text(row.total) })),
    messages: messages.map((row) => ({ id: row.id, body: row.body, status: row.status, at: (row.sentAt ?? row.createdAt).toISOString(), campaign: row.campaign?.name ?? null })),
    ledger,
  };
}

/** A party's account for a period, for the printed statement. */
export async function statementOf(organizationId: string, kind: "CUSTOMER" | "VENDOR", id: string, from: string, to: string) {
  const party =
    kind === "CUSTOMER"
      ? await prisma.customer.findFirst({ where: { id, organizationId }, select: { id: true, code: true, name: true, phone: true, address: true } })
      : await prisma.supplier.findFirst({ where: { id, organizationId }, select: { id: true, code: true, name: true, phone: true, address: true } });
  if (!party) {
    return null;
  }
  const statement = await partyStatement(prisma, { organizationId, partyType: kind, partyId: id, from, to });
  return {
    party,
    from,
    to,
    opening: text(statement.opening),
    closing: text(statement.closing),
    rows: statement.rows.map((row) => ({ id: row.lineId, date: row.businessDate, reference: row.reference, debit: text(row.debit), credit: text(row.credit), balance: text(row.balance) })),
  };
}
