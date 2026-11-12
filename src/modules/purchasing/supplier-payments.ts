import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { moneyAccountFor } from "@/core/ledger/accounts";
import { allocatePayment } from "@/core/payments";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { parseMoney } from "@/core/money";
import { writeAudit } from "@/modules/auth/audit";
import { postBalancedJournal } from "@/modules/accounting/post";
import { allocateNumber } from "@/modules/documents/numbers";
import { StockRuleError } from "@/modules/inventory/stock";
import { outstandingPayable } from "@/modules/purchasing/suppliers";
import { failure, type Actor } from "@/modules/purchasing/common";
import { prisma } from "@/lib/db/client";
import { occurredDate } from "@/lib/format/date";

/** One payment to a vendor: its journal (Dr payable / Cr the cash or bank account) and its document. */
export async function settleSupplier(
  tx: Prisma.TransactionClient,
  input: Actor & { supplierId: string; businessDate: string; amount: Prisma.Decimal; method: "CASH" | "BANK"; purchaseId?: string },
) {
  const number = await allocateNumber(tx, {
    organizationId: input.organizationId,
    documentType: "PAY",
    businessDate: input.businessDate,
  });
  const paymentId = randomUUID();
  const journalId = await postBalancedJournal(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    businessDate: occurredDate(input.businessDate),
    description: `Supplier payment ${number}`,
    createdById: input.userId,
    doc: { type: "SUPPLIER_PAYMENT", id: paymentId },
    lines: [
      { role: "AP", debit: input.amount, credit: new Prisma.Decimal(0), party: { type: "VENDOR" as const, id: input.supplierId } },
      { accountId: await moneyAccountFor(tx, input.organizationId, { method: input.method }), debit: new Prisma.Decimal(0), credit: input.amount },
    ],
  });
  const payment = await tx.supplierPayment.create({
    data: {
      id: paymentId,
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
  return { ...payment, journalId };
}

export async function postSupplierPayment(
  input: Actor & {
    supplierId: string;
    businessDate: string;
    amount: string;
    method: "CASH" | "BANK";
    /** The bills this payment is for; what they do not cover settles the oldest debt first. */
    allocations?: Array<{ billId: string; amount: string }>;
  },
) {
  const requestHash = hashPayload({
    supplierId: input.supplierId,
    businessDate: input.businessDate,
    amount: input.amount,
    method: input.method,
    allocations: input.allocations ?? null,
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
      // One payment to a vendor at a time, so two of them cannot settle the same bill twice.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM suppliers WHERE id = ${input.supplierId} AND organizationId = ${input.organizationId} AND status = 'ACTIVE' FOR UPDATE
      `;
      const supplier = locked[0];
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
      await allocatePayment(tx, {
        organizationId: input.organizationId,
        kind: "VENDOR",
        partyId: supplier.id,
        journalId: payment.journalId,
        amount,
        named: input.allocations?.map((row) => ({ documentId: row.billId, amount: row.amount })),
      });
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
        after: { number: "number" in data ? data.number ?? null : null },
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

/** Kept so a caller that read the database directly keeps working: the supplier of a payment. */
export const supplierPaymentSupplier = (id: string) => prisma.supplierPayment.findUnique({ where: { id }, select: { supplierId: true } });
