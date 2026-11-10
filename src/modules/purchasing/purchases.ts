import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { moneyAccountFor } from "@/core/ledger/accounts";
import { postBalancedJournal } from "@/modules/accounting/post";
import { allocateNumber } from "@/modules/documents/numbers";
import { documentSorts, listQuery, pageInfo, type ListQuery, type Paged } from "@/core/list";
import { hashPayload, idempotentTransaction, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, money, parseMoney, parseQuantity } from "@/core/money";
import { addExpiryLots, applyMovement, resolveWarehouse, StockRuleError } from "@/modules/inventory/stock";
import { outstandingPayable } from "@/modules/purchasing/suppliers";
import { isIsoDate, occurredDate } from "@/lib/format/date";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

export type PurchaseLine = {
  productId: string;
  variantId?: string;
  quantity: string;
  unitCost: string;
  /** Required with `expiresOn` for an expiry-tracked product. */
  lot?: string;
  manufacturedOn?: string;
  expiresOn?: string;
};

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  warehouseId?: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
};

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const status = error instanceof RuleError ? error.status : 422;
    return {
      ok: false,
      status,
      code: status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "BUSINESS_RULE",
      message: error.message,
    };
  }
  if (isKeyRace(error)) {
    throw error;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

export async function postPurchase(
  input: Actor & {
    supplierId: string;
    businessDate: string;
    lines: PurchaseLine[];
    paymentAmount?: string;
    paymentMethod?: "CASH" | "BANK";
  },
) {
  const requestHash = hashPayload({
    supplierId: input.supplierId,
    businessDate: input.businessDate,
    warehouseId: input.warehouseId ?? null,
    lines: input.lines,
    paymentAmount: input.paymentAmount ?? "0.00",
    paymentMethod: input.paymentMethod ?? null,
  });
  try {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, {
        organizationId: input.organizationId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const supplier = await tx.supplier.findFirst({
        where: { id: input.supplierId, organizationId: input.organizationId },
        select: { id: true, status: true, creditLimit: true },
      });
      if (!supplier) {
        throw new StockRuleError("That record was not found.", 404);
      }
      if (supplier.status !== "ACTIVE") {
        throw new StockRuleError("That supplier is not active.");
      }
      const warehouse = await resolveWarehouse(input.organizationId, input.branchId, input.warehouseId);
      if (!warehouse) {
        throw new StockRuleError("Choose an active warehouse on the current branch.");
      }
      const payment = parseMoney(input.paymentAmount ?? "0.00");
      if (!payment) {
        throw new StockRuleError("Enter a payment amount with up to two decimals.");
      }
      if (payment.gt(0) && !input.paymentMethod) {
        throw new StockRuleError("Choose cash or bank for the payment.");
      }
      const priced = input.lines.map((line) => {
        const quantity = parseQuantity(line.quantity);
        const unitCost = parseMoney(line.unitCost);
        if (!quantity || !unitCost) {
          throw new StockRuleError("Enter a quantity greater than zero and a unit cost with up to two decimals.");
        }
        return { ...line, quantity, unitCost, lineTotal: money(quantity.mul(unitCost)) };
      });
      const subtotal = money(priced.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0)));
      if (payment.gt(subtotal)) {
        throw new StockRuleError("The payment is greater than the purchase total.");
      }
      const number = await allocateNumber(tx, {
        organizationId: input.organizationId,
        documentType: "PUR",
        businessDate: input.businessDate,
      });
      const purchase = await tx.purchase.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          number,
          status: "POSTED",
          subtotal,
          discountTotal: new Prisma.Decimal(0),
          vatTotal: new Prisma.Decimal(0),
          chargesTotal: new Prisma.Decimal(0),
          total: subtotal,
          businessDate: occurredDate(input.businessDate),
          createdById: input.userId,
          items: {
            create: priced.map((line) => ({
              organizationId: input.organizationId,
              productId: line.productId,
              variantId: line.variantId ?? null,
              quantity: line.quantity,
              unitCost: line.unitCost,
              lineTotal: line.lineTotal,
            })),
          },
        },
        select: { id: true, number: true },
      });
      for (const line of priced) {
        const product = await tx.product.findFirst({
          where: { id: line.productId, organizationId: input.organizationId, deletedAt: null },
          select: { trackExpiry: true },
        });
        if (!product) {
          throw new StockRuleError("That record was not found.", 404);
        }
        const lotDates = [line.manufacturedOn, line.expiresOn].filter((value): value is string => Boolean(value));
        if (lotDates.some((value) => !isIsoDate(value))) {
          throw new StockRuleError("Dates use YYYY-MM-DD.");
        }
        if (product.trackExpiry && (!line.lot || !line.expiresOn)) {
          throw new StockRuleError("Expiry-tracked products need a lot and an expiry date.");
        }
        await applyMovement(tx, {
          organizationId: input.organizationId,
          productId: line.productId,
          variantId: line.variantId,
          branchId: input.branchId,
          warehouseId: warehouse.id,
          quantity: line.quantity,
          direction: "IN",
          movementType: "PURCHASE",
          referenceType: "purchase",
          referenceId: purchase.id,
          userId: input.userId,
          unitCost: line.unitCost,
        });
        // The received quantity becomes a lot, so selling and expiring it later can be tracked.
        if (product.trackExpiry && line.lot && line.expiresOn) {
          await addExpiryLots(tx, {
            organizationId: input.organizationId,
            branchId: input.branchId,
            productId: line.productId,
            variantId: line.variantId,
            lots: [
              {
                lot: line.lot,
                expiresOn: occurredDate(line.expiresOn),
                manufacturedOn: line.manufacturedOn ? occurredDate(line.manufacturedOn) : null,
                quantity: line.quantity,
              },
            ],
          });
        }
      }
      const purchaseJournalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Purchase ${number}`,
        createdById: input.userId,
        lines: [
          { role: "INVENTORY", debit: subtotal, credit: new Prisma.Decimal(0) },
          { role: "AP", debit: new Prisma.Decimal(0), credit: subtotal },
        ],
      });
      await tx.purchase.update({ where: { id: purchase.id }, data: { journalId: purchaseJournalId } });
      await tx.supplierLedger.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          supplierId: supplier.id,
          businessDate: occurredDate(input.businessDate),
          entryType: "PURCHASE",
          credit: subtotal,
          referenceType: "purchase",
          referenceId: purchase.id,
        },
      });
      if (payment.gt(0) && input.paymentMethod) {
        await settleSupplier(tx, {
          ...input,
          supplierId: supplier.id,
          businessDate: input.businessDate,
          amount: payment,
          method: input.paymentMethod,
          purchaseId: purchase.id,
        });
      }
      if (supplier.creditLimit) {
        const balance = await outstandingPayable(input.organizationId, supplier.id, tx);
        if (balance.gt(supplier.creditLimit)) {
          throw new StockRuleError("The purchase exceeds the supplier credit limit.");
        }
      }
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "purchase",
        entityId: purchase.id,
      });
      return { id: purchase.id, number: purchase.number, replayed: false, total: decimalString(subtotal, 2) };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "purchase",
        module: "purchases",
        entityType: "purchase",
        entityId: data.id,
        after: { number: data.number },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    return { ok: true as const, ...data };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

async function settleSupplier(
  tx: Prisma.TransactionClient,
  input: Actor & { supplierId: string; businessDate: string; amount: Prisma.Decimal; method: "CASH" | "BANK"; purchaseId?: string },
) {
  const number = await allocateNumber(tx, {
    organizationId: input.organizationId,
    documentType: "PAY",
    businessDate: input.businessDate,
  });
  const journalId = await postBalancedJournal(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    businessDate: occurredDate(input.businessDate),
    description: `Supplier payment ${number}`,
    createdById: input.userId,
    lines: [
      { role: "AP", debit: input.amount, credit: new Prisma.Decimal(0) },
      { accountId: await moneyAccountFor(tx, input.organizationId, { method: input.method }), debit: new Prisma.Decimal(0), credit: input.amount },
    ],
  });
  const payment = await tx.supplierPayment.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      supplierId: input.supplierId,
      number,
      businessDate: occurredDate(input.businessDate),
      method: input.method,
      amount: input.amount,
      journalId,
    },
    select: { id: true, number: true },
  });
  if (input.purchaseId) {
    await tx.purchasePayment.create({
      data: {
        organizationId: input.organizationId,
        purchaseId: input.purchaseId,
        method: input.method,
        amount: input.amount,
      },
    });
  }
  await tx.supplierLedger.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      supplierId: input.supplierId,
      businessDate: occurredDate(input.businessDate),
      entryType: "PAYMENT",
      debit: input.amount,
      referenceType: "supplier_payment",
      referenceId: payment.id,
    },
  });
  return payment;
}

export async function postSupplierPayment(
  input: Actor & { supplierId: string; businessDate: string; amount: string; method: "CASH" | "BANK" },
) {
  const requestHash = hashPayload({
    supplierId: input.supplierId,
    businessDate: input.businessDate,
    amount: input.amount,
    method: input.method,
  });
  try {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, {
        organizationId: input.organizationId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true };
      }
      const supplier = await tx.supplier.findFirst({
        where: { id: input.supplierId, organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!supplier) {
        throw new StockRuleError("That record was not found.", 404);
      }
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new StockRuleError("Enter a payment amount greater than zero.");
      }
      const balance = await outstandingPayable(input.organizationId, supplier.id, tx);
      if (amount.gt(balance)) {
        throw new StockRuleError("The payment is greater than the outstanding payable.");
      }
      const payment = await settleSupplier(tx, { ...input, supplierId: supplier.id, amount });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "supplier_payment",
        entityId: payment.id,
      });
      return { id: payment.id, number: payment.number, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "payment",
        module: "suppliers",
        entityType: "supplier_payment",
        entityId: data.id,
        after: { number: data.number ?? null },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    return { ok: true as const, ...data };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/** The sorts a purchase list may ask for: by date or by number, newest first by default. */
export const purchaseSorts = documentSorts({ number: "asc" });

/** One page of the branch's purchases, newest first (business date, then number). `search` matches the number or the supplier name in SQL. */
export async function listPurchases(
  organizationId: string,
  branchId: string,
  query: ListQuery = listQuery({}, { sorts: purchaseSorts }),
  search = "",
): Promise<Paged<{ id: string; number: string | null; status: string; total: string; businessDate: string; supplierName: string }>> {
  const text = search.trim();
  const where: Prisma.PurchaseWhereInput = {
    organizationId,
    branchId,
    ...(text ? { OR: [{ number: { contains: text } }, { supplier: { name: { contains: text } } }] } : {}),
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
    })),
    page: pageInfo(total, query, rows.length),
  };
}

export async function getPurchase(organizationId: string, branchId: string, id: string) {
  const row = await prisma.purchase.findFirst({
    where: { id, organizationId, branchId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { product: { select: { sku: true, name: true } } } },
      payments: true,
      journal: { include: { lines: { select: { debit: true, credit: true } } } },
    },
  });
  if (!row) {
    return null;
  }
  const debit = row.journal?.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0)) ?? new Prisma.Decimal(0);
  const credit = row.journal?.lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0)) ?? new Prisma.Decimal(0);
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    businessDate: dateOnly(row.businessDate),
    supplier: row.supplier,
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
      unitCost: decimalString(item.unitCost, 2),
      lineTotal: decimalString(item.lineTotal, 2),
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: decimalString(payment.amount, 2),
    })),
  };
}
