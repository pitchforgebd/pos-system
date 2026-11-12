import { Prisma } from "@prisma/client";

import { documentSorts, listQuery, pageInfo, type ListQuery, type Paged } from "@/core/list";
import { decimalString } from "@/core/money";
import { billPayment } from "@/core/payments";
import { dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";

// Reading purchases. Writing them is in orders.ts (the life of a purchase) and supplier-payments.ts (paying the vendor).

export { cancelPurchase, draftsFromReorder, orderPurchase, placePurchase, postPurchase, previewPurchase, receivePurchase, saveDraftPurchase, updatePurchase } from "@/modules/purchasing/orders";
export type { PurchaseInput, PurchaseLineInput, PurchaseMode, ReceiveInput } from "@/modules/purchasing/orders";
export { applySupplierAdvance, postSupplierAdvance, postSupplierPayment, settleSupplier } from "@/modules/purchasing/supplier-payments";
export type { ApplyAdvanceInput, SupplierAdvanceInput, SupplierPaymentInput } from "@/modules/purchasing/supplier-payments";
export type { Actor } from "@/modules/purchasing/common";

/** The sorts a purchase list may ask for: by date or by number, newest first by default. */
export const purchaseSorts = documentSorts({ number: "asc" });

/** One page of the branch's purchases, newest first (business date, then number). `search` matches the number, the bill number or the supplier name in SQL; `status` narrows to one state. */
export async function listPurchases(
  organizationId: string,
  branchId: string,
  query: ListQuery = listQuery({}, { sorts: purchaseSorts }),
  search = "",
  status?: "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED",
): Promise<Paged<{ id: string; number: string | null; status: string; total: string; businessDate: string; supplierName: string; supplierInvoiceNo: string | null }>> {
  const text = search.trim();
  const where: Prisma.PurchaseWhereInput = {
    organizationId,
    branchId,
    ...(status ? { status } : {}),
    ...(text ? { OR: [{ number: { contains: text } }, { supplierInvoiceNo: { contains: text } }, { supplier: { name: { contains: text } } }] } : {}),
  };
  const total = await prisma.purchase.count({ where });
  const rows = await prisma.purchase.findMany({
    where,
    orderBy: query.orderBy as Prisma.PurchaseOrderByWithRelationInput[],
    skip: query.skip,
    take: query.take,
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      businessDate: true,
      supplierInvoiceNo: true,
      supplier: { select: { name: true } },
    },
  });
  return {
    rows: rows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      total: decimalString(row.total, 2),
      businessDate: dateOnly(row.businessDate),
      supplierName: row.supplier.name,
      supplierInvoiceNo: row.supplierInvoiceNo,
    })),
    page: pageInfo(total, query, rows.length),
  };
}

export async function getPurchase(organizationId: string, branchId: string, id: string) {
  const row = await prisma.purchase.findFirst({
    where: { id, organizationId, branchId },
    include: {
      supplier: { select: { id: true, name: true } },
      warehouse:{ select: { id: true, name: true } },
      items: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { product: { select: { sku: true, name: true } } } },
      payments: true,
      journal: { include: { lines: { select: { debit: true, credit: true } } } },
    },
  });
  if (!row) {
    return null;
  }
  const debit = row.journal?.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0)) ?? new Prisma.Decimal(0);
  const credit = row.journal?.lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0)) ?? new Prisma.Decimal(0);
  const transporter = row.transporterId ? await prisma.supplier.findFirst({ where: { id: row.transporterId, organizationId }, select: { id: true, name: true } }) : null;
  const received = row.status === "RECEIVED";
  const payment = received ? await billPayment(prisma, organizationId, row.id) : null;
  return {
    id: row.id,
    number: row.number,
    /** PAID, PARTIAL or UNPAID; what is still owed on the bill, and what payments have settled since. Only a received purchase is a bill. */
    paymentStatus: payment?.status ?? null,
    owed: payment ? decimalString(payment.owed, 2) : null,
    paidLater: payment ? decimalString(payment.allocated, 2) : null,
    status: row.status,
    businessDate: dateOnly(row.businessDate),
    receivedOn: row.receivedOn ? dateOnly(row.receivedOn) : null,
    supplierInvoiceNo: row.supplierInvoiceNo,
    note: row.note,
    supplier: row.supplier,
    warehouse: row.warehouse,
    warehouseId: row.warehouseId,
    transporter,
    vehicleNo: row.vehicleNo,
    transportPaidWith: row.transportPaidWith,
    subtotal: decimalString(row.subtotal, 2),
    discountTotal: decimalString(row.discountTotal, 2),
    headerDiscount: decimalString(row.headerDiscount, 2),
    vatTotal: decimalString(row.vatTotal, 2),
    transportCost: decimalString(row.transportCost, 2),
    otherCost: decimalString(row.otherCost, 2),
    chargesTotal: decimalString(row.chargesTotal, 2),
    total: decimalString(row.total, 2),
    /** What the whole purchase cost: the vendor's bill plus the haulage and other costs. */
    landedTotal: decimalString(row.total.plus(row.chargesTotal), 2),
    journalBalanced: debit.eq(credit),
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      sku: item.product.sku,
      name: item.product.name,
      quantity: decimalString(item.quantity, 4),
      unitCost: decimalString(item.unitCost, 4),
      discount: decimalString(item.discount, 2),
      vatRate: decimalString(item.vatRate, 2),
      vatAmount: decimalString(item.vatAmount, 2),
      lineTotal: decimalString(item.lineTotal, 2),
      landedUnitCost: item.landedUnitCost ? decimalString(item.landedUnitCost, 4) : null,
      lot: item.lot,
      manufacturedOn: item.manufacturedOn ? dateOnly(item.manufacturedOn) : null,
      expiresOn: item.expiresOn ? dateOnly(item.expiresOn) : null,
      serials: Array.isArray(item.serials) ? (item.serials as string[]) : [],
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: decimalString(payment.amount, 2),
    })),
  };
}
