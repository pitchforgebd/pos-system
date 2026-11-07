import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { PostingError, postBalancedJournal } from "@/modules/accounting/post";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/modules/inventory/idempotency";
import { decimalString, parseMoney } from "@/modules/inventory/money";
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
  if (error instanceof StockRuleError) {
    const code = error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return { ok: false, status: error.status, code, message: error.message };
  }
  if (error instanceof PostingError) {
    return { ok: false, status: 422, code: "BUSINESS_RULE", message: error.message };
  }
  return null;
}

export async function postCustomerAdvance(
  input: Actor & { customerId: string; occurredOn: string; amount: string; method: "CASH" | "BANK" },
) {
  const requestHash = hashPayload({
    customerId: input.customerId,
    occurredOn: input.occurredOn,
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
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM customers WHERE id = ${input.customerId} AND organizationId = ${input.organizationId} FOR UPDATE
      `;
      const customer = rows[0];
      if (!customer) {
        throw new StockRuleError("That record was not found.", 404);
      }
      if (customer.status !== "ACTIVE") {
        throw new StockRuleError("That customer is inactive.");
      }
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new StockRuleError("Enter an advance amount greater than zero.");
      }
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        occurredOn: occurredDate(input.occurredOn),
        description: "Customer advance",
        createdById: input.userId,
        lines: [
          { accountCode: input.method === "CASH" ? "1100" : "1200", debit: amount, credit: new Prisma.Decimal(0) },
          { accountCode: "1300", debit: new Prisma.Decimal(0), credit: amount },
        ],
      });
      const advance = await tx.customerAdvance.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          customerId: input.customerId,
          occurredOn: occurredDate(input.occurredOn),
          method: input.method,
          amount,
          journalId,
        },
        select: { id: true },
      });
      await tx.customerLedger.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          customerId: input.customerId,
          occurredOn: occurredDate(input.occurredOn),
          entryType: "ADVANCE",
          credit: amount,
          referenceType: "customer_advance",
          referenceId: advance.id,
        },
      });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "customer_advance",
        entityId: advance.id,
      });
      return { id: advance.id, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "advance",
        module: "customers",
        entityType: "customer_advance",
        entityId: data.id,
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

export async function listCustomerAdvances(organizationId: string, branchId: string) {
  const rows = await prisma.customerAdvance.findMany({
    where: { organizationId, branchId },
    orderBy: { occurredOn: "desc" },
    take: 100,
    select: {
      id: true,
      occurredOn: true,
      method: true,
      amount: true,
      customer: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    customerName: row.customer.name,
    method: row.method,
    amount: decimalString(row.amount, 2),
  }));
}
