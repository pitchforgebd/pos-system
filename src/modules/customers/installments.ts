import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { businessDate, dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { decimalString, parseMoney } from "@/modules/inventory/money";
import { StockRuleError } from "@/modules/inventory/stock";
import { occurredDate } from "@/lib/format/date";

type Failure = { ok: false; status: 404 | 422; code: "NOT_FOUND" | "BUSINESS_RULE"; message: string };

function dateString(value: Date) {
  return dateOnly(value);
}

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    return {
      ok: false,
      status: error.status === 404 ? 404 : 422,
      code: error.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE",
      message: error.message,
    };
  }
  return null;
}

export async function createInstallment(input: {
  organizationId: string;
  branchId: string;
  actorId: string;
  customerId: string;
  invoiceId: string;
  amount: string;
  dueOn: string;
  interestPercent?: string | null;
  ip: string;
  userAgent: string | null;
}) {
  const amount = parseMoney(input.amount);
  if (!amount || amount.lte(0)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter an installment amount greater than zero." };
  }
  const interestText = input.interestPercent?.trim() ?? "";
  const interestPercent = interestText ? parseMoney(interestText) : null;
  if (interestText && (!interestPercent || interestPercent.isNeg() || interestPercent.gt(100))) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter an interest percent from 0 to 100, or leave it blank." };
  }
  try {
    const installment = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM invoices WHERE id = ${input.invoiceId} AND organizationId = ${input.organizationId} AND branchId = ${input.branchId} FOR UPDATE
      `;
      if (!locked[0]) {
        throw new StockRuleError("That record was not found.", 404);
      }
      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, organizationId: input.organizationId, branchId: input.branchId },
        select: { id: true, total: true, customerId: true, sale: { select: { status: true, customerId: true } } },
      });
      if (!invoice || invoice.sale.status !== "POSTED" || invoice.sale.customerId !== input.customerId || invoice.customerId !== input.customerId) {
        throw new StockRuleError("That record was not found.", 404);
      }
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: input.organizationId },
        select: { status: true },
      });
      if (!customer) {
        throw new StockRuleError("That record was not found.", 404);
      }
      if (customer.status !== "ACTIVE") {
        throw new StockRuleError("That customer is inactive.");
      }
      const prior = await tx.installment.aggregate({
        where: { invoiceId: invoice.id },
        _sum: { amount: true },
      });
      const used = new Prisma.Decimal(prior._sum.amount ?? 0);
      if (used.plus(amount).gt(invoice.total)) {
        throw new StockRuleError("The reminders are greater than the invoice total.");
      }
      return tx.installment.create({
        data: {
          organizationId: input.organizationId,
          customerId: input.customerId,
          invoiceId: invoice.id,
          amount,
          interestPercent,
          dueOn: occurredDate(input.dueOn),
        },
        select: { id: true },
      });
    });
    await writeAudit({
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.actorId,
      action: "create",
      module: "customers",
      entityType: "installment",
      entityId: installment.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true as const, installment };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function closeInstallment(input: {
  organizationId: string;
  actorId: string;
  installmentId: string;
  ip: string;
  userAgent: string | null;
}) {
  const current = await prisma.installment.findFirst({
    where: { id: input.installmentId, organizationId: input.organizationId },
    select: { id: true, status: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  if (current.status === "PAID") {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "That reminder is already closed." };
  }
  await prisma.installment.update({ where: { id: current.id }, data: { status: "PAID" } });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "close",
    module: "customers",
    entityType: "installment",
    entityId: current.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, id: current.id };
}

export async function listInstallments(organizationId: string) {
  const rows = await prisma.installment.findMany({
    where: { organizationId },
    orderBy: { dueOn: "asc" },
    take: 200,
    select: {
      id: true,
      amount: true,
      interestPercent: true,
      dueOn: true,
      status: true,
      customer: { select: { name: true } },
      invoice: { select: { number: true } },
    },
  });
  const today = businessDate();
  return rows.map((row) => {
    const dueOn = dateString(row.dueOn);
    const displayStatus = row.status === "PAID" ? "PAID" : dueOn < today ? "OVERDUE" : "OPEN";
    return {
      id: row.id,
      invoiceNumber: row.invoice.number,
      customerName: row.customer.name,
      dueOn,
      amount: decimalString(row.amount, 2),
      interestPercent: row.interestPercent === null ? "" : decimalString(row.interestPercent, 2),
      interestAmount: row.interestPercent === null ? "" : decimalString(new Prisma.Decimal(row.amount).mul(row.interestPercent).div(100).toDecimalPlaces(2), 2),
      status: row.status,
      displayStatus,
    };
  });
}
