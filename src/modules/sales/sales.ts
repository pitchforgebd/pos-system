import { Prisma } from "@prisma/client";

import { documentSorts, listQuery, pageInfo, type ListQuery, type Paged } from "@/core/list";
import { decimalString, zero } from "@/core/money";
import { invoicePayment } from "@/core/payments";
import { dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/modules/purchasing/common";
import { outstandingReceivable } from "@/modules/customers/customers";
import { postInvoice, type InvoiceLine } from "@/modules/sales/invoice";

export { postInvoice, previewSale } from "@/modules/sales/invoice";
export type { InvoiceInput, InvoiceLine, TenderInput } from "@/modules/sales/invoice";

export type SaleLine = InvoiceLine;

/**
 * A sale with at most one payment: the form the till and the old callers use. It is an invoice with one tender (CARD is a bank payment,
 * OTHER is cash); all the rules are the invoice's.
 */
export function postSale(
  input: Actor & {
    businessDate: string;
    customerId?: string;
    ticketId?: string;
    chargesTotal?: string;
    lines: SaleLine[];
    paymentAmount?: string;
    paymentMethod?: "CASH" | "BANK" | "CARD" | "WALLET" | "OTHER";
    allowPriceOverride?: boolean;
    /** Runs inside the sale transaction, so extra writes commit or roll back with the sale. */
    inTransaction?: (tx: Prisma.TransactionClient, sale: { id: string }) => Promise<void>;
  },
) {
  const { paymentAmount, paymentMethod, ...rest } = input;
  const method = paymentMethod === "OTHER" || !paymentMethod ? "CASH" : paymentMethod;
  return postInvoice({ ...rest, tenders: paymentAmount && Number(paymentAmount) !== 0 ? [{ method, amount: paymentAmount }] : [] });
}

/** The sorts a sale list may ask for: by date or by invoice number, newest first by default. */
export const saleSorts = documentSorts({ invoice: { number: "asc" } });

/** One page of the branch's sales, newest first (business date, then invoice number), with the total for the pager. */
export async function listSales(
  organizationId: string,
  branchId: string,
  query: ListQuery = listQuery({}, { sorts: saleSorts }),
  /** Only this cashier's sales, and/or only this business day (the register's own history). */
  only: { createdById?: string; date?: string } = {},
): Promise<Paged<{ id: string; number: string | null; status: string; total: string; businessDate: string; customerName: string }>> {
  const where: Prisma.SaleWhereInput = { organizationId, branchId, ...(only.createdById ? { createdById: only.createdById } : {}), ...(only.date ? { businessDate: new Date(`${only.date}T00:00:00.000Z`) } : {}) };
  const total = await prisma.sale.count({ where });
  const rows = await prisma.sale.findMany({
    where,
    orderBy: query.orderBy as Prisma.SaleOrderByWithRelationInput[],
    skip: query.skip,
    take: query.take,
    select: {
      id: true,
      status: true,
      total: true,
      businessDate: true,
      customer: { select: { name: true } },
      invoice: { select: { number: true } },
    },
  });
  return {
    rows: rows.map((row) => ({
      id: row.id,
      number: row.invoice?.number ?? null,
      status: row.status,
      total: decimalString(row.total, 2),
      businessDate: dateOnly(row.businessDate),
      customerName: row.customer?.name ?? "Walk-in",
    })),
    page: pageInfo(total, query, rows.length),
  };
}

export async function getSale(organizationId: string, branchId: string, id: string) {
  const row = await prisma.sale.findFirst({
    where: { id, organizationId, branchId },
    include: {
      customer: { select: { id: true, name: true, isSystem: true } },
      invoice: { select: { number: true } },
      items: { include: { product: { select: { sku: true, name: true } } } },
      payments: true,
      journal: { include: { lines: { select: { debit: true, credit: true } } } },
    },
  });
  if (!row) {
    return null;
  }
  const debit = row.journal?.lines.reduce((sum, line) => sum.plus(line.debit), zero()) ?? zero();
  const credit = row.journal?.lines.reduce((sum, line) => sum.plus(line.credit), zero()) ?? zero();
  const payment = await invoicePayment(prisma, organizationId, row.id);
  const level = row.priceLevelId ? await prisma.priceLevel.findFirst({ where: { id: row.priceLevelId, organizationId }, select: { name: true } }) : null;
  const customerDue = row.customer && !row.customer.isSystem ? await outstandingReceivable(organizationId, row.customer.id) : zero();
  return {
    priceLevel: level?.name ?? null,
    /** What this customer owes the shop altogether now (the invoice's own part is in `owed`). */
    customerDue: decimalString(customerDue, 2),
    id: row.id,
    number: row.invoice?.number ?? null,
    /** PAID, PARTIAL or UNPAID; what is still owed on the invoice, and what receipts have settled since. */
    paymentStatus: payment.status,
    owed: decimalString(payment.owed, 2),
    received: decimalString(payment.allocated, 2),
    status: row.status,
    businessDate: dateOnly(row.businessDate),
    customerName: row.customer?.name ?? "Walk-in",
    subtotal: decimalString(row.subtotal, 2),
    discountTotal: decimalString(row.discountTotal, 2),
    vatTotal: decimalString(row.vatTotal, 2),
    chargesTotal: decimalString(row.chargesTotal, 2),
    total: decimalString(row.total, 2),
    journalBalanced: debit.eq(credit),
    items: row.items.map((item) => ({
      id: item.id,
      sku: item.product.sku,
      name: item.product.name,
      quantity: decimalString(item.quantity, 4),
      unitPrice: decimalString(item.unitPrice, 2),
      lineTotal: decimalString(item.lineTotal, 2),
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: decimalString(payment.amount, 2),
    })),
  };
}
