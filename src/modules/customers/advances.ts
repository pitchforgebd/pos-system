import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { randomUUID } from "node:crypto";

import { moneyAccountFor } from "@/core/ledger/accounts";
import { postBalancedJournal } from "@/modules/accounting/post";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
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
  return null;
}

export async function postCustomerAdvance(
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
      const advanceId = randomUUID();
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: "Customer advance",
        createdById: input.userId,
        doc: { type: "CUSTOMER_ADVANCE", id: advanceId },
        lines: [
          { accountId: await moneyAccountFor(tx, input.organizationId, { method: input.method }), debit: amount, credit: new Prisma.Decimal(0) },
          { role: "AR", debit: new Prisma.Decimal(0), credit: amount, party: { type: "CUSTOMER" as const, id: input.customerId } },
        ],
      });
      const advance = await tx.customerAdvance.create({
        data: {
          id: advanceId,
          organizationId: input.organizationId,
          branchId: input.branchId,
          customerId: input.customerId,
          businessDate: occurredDate(input.businessDate),
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
          businessDate: occurredDate(input.businessDate),
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
    orderBy: { businessDate: "desc" },
    take: 100,
    select: {
      id: true,
      businessDate: true,
      method: true,
      amount: true,
      customer: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    businessDate: dateOnly(row.businessDate),
    customerName: row.customer.name,
    method: row.method,
    amount: decimalString(row.amount, 2),
  }));
}
