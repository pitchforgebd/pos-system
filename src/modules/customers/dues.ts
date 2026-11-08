import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { postBalancedJournal } from "@/modules/accounting/post";
import { outstandingReceivable } from "@/modules/customers/customers";
import { allocateNumber } from "@/modules/documents/numbers";
import { hashPayload, idempotentTransaction, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, parseMoney } from "@/core/money";
import { StockRuleError } from "@/modules/inventory/stock";
import { occurredDate } from "@/lib/format/date";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
};

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const code = error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return { ok: false, status: error.status, code, message: error.message };
  }
  if (error instanceof RuleError) {
    return { ok: false, status: 422, code: "BUSINESS_RULE", message: error.message };
  }
  if (isKeyRace(error)) {
    throw error;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

async function lockCustomer(tx: Prisma.TransactionClient, organizationId: string, customerId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status FROM customers WHERE id = ${customerId} AND organizationId = ${organizationId} FOR UPDATE
  `;
  const customer = rows[0];
  if (!customer) {
    throw new StockRuleError("That record was not found.", 404);
  }
  if (customer.status !== "ACTIVE") {
    throw new StockRuleError("That customer is inactive.");
  }
  return customer;
}

export async function postCustomerPayment(
  input: Actor & { customerId: string; businessDate: string; amount: string; method: "CASH" | "BANK" },
) {
  const requestHash = hashPayload({
    customerId: input.customerId,
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
        const payment = await tx.customerPayment.findFirst({
          where: { id: existing.entityId, organizationId: input.organizationId },
          select: { id: true, number: true },
        });
        return { id: existing.entityId, number: payment?.number ?? null, replayed: true };
      }
      await lockCustomer(tx, input.organizationId, input.customerId);
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new StockRuleError("Enter a payment amount greater than zero.");
      }
      const balance = await outstandingReceivable(input.organizationId, input.customerId, tx);
      if (amount.gt(balance)) {
        throw new StockRuleError("The payment is greater than the outstanding due.");
      }
      const number = await allocateNumber(tx, {
        organizationId: input.organizationId,
        documentType: "PAY",
        businessDate: input.businessDate,
      });
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Customer payment ${number}`,
        createdById: input.userId,
        lines: [
          { accountCode: input.method === "CASH" ? "1100" : "1200", debit: amount, credit: new Prisma.Decimal(0) },
          { accountCode: "1300", debit: new Prisma.Decimal(0), credit: amount },
        ],
      });
      const payment = await tx.customerPayment.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          customerId: input.customerId,
          number,
          businessDate: occurredDate(input.businessDate),
          method: input.method,
          amount,
          journalId,
        },
        select: { id: true, number: true },
      });
      await tx.customerLedger.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          customerId: input.customerId,
          businessDate: occurredDate(input.businessDate),
          entryType: "PAYMENT",
          credit: amount,
          referenceType: "customer_payment",
          referenceId: payment.id,
        },
      });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "customer_payment",
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
        module: "customers",
        entityType: "customer_payment",
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

export async function listCustomerPayments(organizationId: string, branchId: string) {
  const rows = await prisma.customerPayment.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      businessDate: true,
      method: true,
      amount: true,
      customer: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number ?? row.id,
    businessDate: dateOnly(row.businessDate),
    customerName: row.customer.name,
    method: row.method,
    amount: decimalString(row.amount, 2),
  }));
}
