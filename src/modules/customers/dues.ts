import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

import { paymentStatuses } from "@/core/payments";
import { outstandingReceivable } from "@/modules/customers/customers";
import { takeReceipt } from "@/modules/sales/receipts";
import { hashPayload, idempotentTransaction, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, parseMoney } from "@/core/money";
import { StockRuleError } from "@/modules/inventory/stock";

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
  input: Actor & {
    customerId: string;
    businessDate: string;
    amount: string;
    method: "CASH" | "BANK" | "MOBILE";
    /** The cash, bank or mobile account the money came into (the default drawer or bank when left out). */
    accountId?: string;
    /** What the bank or mobile service kept (D7). */
    charge?: string;
    /** The invoices this receipt is for; what they do not cover settles the oldest debt first. */
    allocations?: Array<{ invoiceId: string; amount: string }>;
  },
) {
  const requestHash = hashPayload({
    customerId: input.customerId,
    businessDate: input.businessDate,
    amount: input.amount,
    method: input.method,
    accountId: input.accountId ?? null,
    charge: input.charge ?? null,
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
      // D7: a bank or mobile charge is the shop's expense; the customer is credited the whole amount
      const charge = parseMoney(input.charge ?? "0.00");
      if (!charge || charge.isNeg()) {
        throw new StockRuleError("Enter a charge with up to two decimals.");
      }
      const payment = await takeReceipt(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        customerId: input.customerId,
        businessDate: input.businessDate,
        tender: { method: input.method, accountId: input.accountId, amount, charge },
        named: input.allocations?.map((row) => ({ documentId: row.invoiceId, amount: row.amount })),
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

/** The customer's invoices that still have something owed on them, oldest first, with how much (for choosing what a receipt is for). */
export async function listOpenInvoices(organizationId: string, customerId: string) {
  const sales = await prisma.sale.findMany({
    where: { organizationId, customerId, status: "POSTED" },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
    take: 300,
    select: { id: true, businessDate: true, total: true, invoice: { select: { number: true } } },
  });
  const status = await paymentStatuses(prisma, organizationId, "CUSTOMER", sales.map((sale) => ({ id: sale.id, total: sale.total })));
  return sales.flatMap((sale) => {
    const figures = status.get(sale.id);
    if (!figures || figures.owed.lte(0)) {
      return [];
    }
    return [{ id: sale.id, number: sale.invoice?.number ?? null, businessDate: dateOnly(sale.businessDate), total: decimalString(sale.total, 2), owed: decimalString(figures.owed, 2), status: figures.status }];
  });
}
