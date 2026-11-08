import { Prisma } from "@prisma/client";
import { runTx } from "@/core/tx/run";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { hashPayload, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, parseMoney, parseQuantity } from "@/core/money";
import { StockRuleError } from "@/modules/inventory/stock";
import { postSale } from "@/modules/sales/sales";
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

function dateString(value: Date) {
  return dateOnly(value);
}

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const code = error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return { ok: false, status: error.status, code, message: error.message };
  }
  if (isKeyRace(error)) {
    throw error;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

function present(row: {
  id: string;
  number: string;
  status: "DRAFT" | "SENT" | "ACCEPTED";
  businessDate: Date;
  note: string | null;
  customer: { name: string };
  saleId?: string | null;
  _count?: { items: number };
  items?: Array<{ quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; product: { name: string; sku: string } }>;
}) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    businessDate: dateString(row.businessDate),
    note: row.note,
    customerName: row.customer.name,
    saleId: row.saleId ?? null,
    lineCount: row._count?.items ?? row.items?.length ?? 0,
    items: (row.items ?? []).map((item) => ({
      name: item.product.name,
      sku: item.product.sku,
      quantity: decimalString(item.quantity, 4),
      unitPrice: decimalString(item.unitPrice, 2),
      lineTotal: decimalString(item.lineTotal, 2),
    })),
  };
}

async function lockQuotation(tx: Prisma.TransactionClient, organizationId: string, branchId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: "DRAFT" | "SENT" | "ACCEPTED" }>>`
    SELECT id, status FROM quotations
    WHERE id = ${id} AND organizationId = ${organizationId} AND branchId = ${branchId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new StockRuleError("That record was not found.", 404);
  }
  return row;
}

export async function listQuotations(organizationId: string, branchId: string) {
  const rows = await prisma.quotation.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      status: true,
      businessDate: true,
      note: true,
      saleId: true,
      customer: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });
  return rows.map(present);
}

export async function getQuotation(organizationId: string, branchId: string, id: string) {
  const row = await prisma.quotation.findFirst({
    where: { id, organizationId, branchId },
    select: {
      id: true,
      number: true,
      status: true,
      businessDate: true,
      note: true,
      saleId: true,
      customer: { select: { name: true } },
      items: { select: { quantity: true, unitPrice: true, lineTotal: true, product: { select: { name: true, sku: true } } } },
    },
  });
  return row ? present(row) : null;
}

export async function createQuotation(input: Actor & { customerId: string; businessDate: string; note?: string | null; lines?: { productId: string; quantity: string; unitPrice: string }[] }) {
  const note = input.note?.trim() || null;
  if (note && note.length > 255) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "The note is too long." };
  }
  const lines = input.lines ?? [];
  const requestHash = hashPayload({ customerId: input.customerId, businessDate: input.businessDate, note, lines });
  try {
    const data = await runTx(async (tx) => {
      const existing = await readIdempotency(tx, {
        organizationId: input.organizationId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        const quotation = await tx.quotation.findFirst({
          where: { id: existing.entityId, organizationId: input.organizationId },
          select: { id: true, number: true },
        });
        return { id: existing.entityId, number: quotation?.number ?? null, replayed: true };
      }
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!customer) {
        throw new StockRuleError("Choose an active customer.");
      }
      const number = await allocateNumber(tx, {
        organizationId: input.organizationId,
        documentType: "QUO",
        businessDate: input.businessDate,
      });
      const priced = [];
      for (const line of lines) {
        const quantity = parseQuantity(line.quantity);
        const unitPrice = parseMoney(line.unitPrice);
        if (!quantity || !unitPrice || unitPrice.isNeg()) {
          throw new StockRuleError("Enter a quantity and a unit price for each quotation line.");
        }
        const product = await tx.product.findFirst({
          where: { id: line.productId, organizationId: input.organizationId, deletedAt: null, status: "ACTIVE" },
          select: { id: true },
        });
        if (!product) {
          throw new StockRuleError("Choose an active product.");
        }
        priced.push({
          organizationId: input.organizationId,
          productId: product.id,
          quantity,
          unitPrice,
          lineTotal: unitPrice.mul(quantity).toDecimalPlaces(2),
        });
      }
      const quotation = await tx.quotation.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          customerId: customer.id,
          number,
          businessDate: occurredDate(input.businessDate),
          note,
          createdById: input.userId,
          items: { create: priced },
        },
        select: { id: true, number: true },
      });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "quotation",
        entityId: quotation.id,
      });
      return { id: quotation.id, number: quotation.number, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "create",
        module: "quotations",
        entityType: "quotation",
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

async function moveQuotation(input: {
  organizationId: string;
  branchId: string;
  userId: string;
  quotationId: string;
  from: "DRAFT" | "SENT";
  to: "SENT" | "ACCEPTED";
  action: string;
  ip: string;
  userAgent: string | null;
}) {
  try {
    const data = await runTx(async (tx) => {
      const current = await lockQuotation(tx, input.organizationId, input.branchId, input.quotationId);
      if (current.status !== input.from) {
        throw new StockRuleError(input.from === "DRAFT" ? "Only a draft quotation can be sent." : "Only a sent quotation can be accepted.");
      }
      await tx.quotation.update({ where: { id: current.id }, data: { status: input.to } });
      return { id: current.id };
    });
    await writeAudit({
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.userId,
      action: input.action,
      module: "quotations",
      entityType: "quotation",
      entityId: data.id,
      after: { status: input.to },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true as const, id: data.id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export function sendQuotation(input: {
  organizationId: string;
  branchId: string;
  userId: string;
  quotationId: string;
  ip: string;
  userAgent: string | null;
}) {
  return moveQuotation({ ...input, from: "DRAFT", to: "SENT", action: "send" });
}

export function acceptQuotation(input: {
  organizationId: string;
  branchId: string;
  userId: string;
  quotationId: string;
  ip: string;
  userAgent: string | null;
}) {
  return moveQuotation({ ...input, from: "SENT", to: "ACCEPTED", action: "accept" });
}

export async function convertQuotation(input: {
  organizationId: string;
  branchId: string;
  quotationId: string;
  userId?: string;
  idempotencyKey?: string;
  ip?: string;
  userAgent?: string | null;
}) {
  const current = await prisma.quotation.findFirst({
    where: { id: input.quotationId, organizationId: input.organizationId, branchId: input.branchId },
    select: {
      id: true,
      saleId: true,
      customerId: true,
      businessDate: true,
      items: { select: { productId: true, quantity: true, unitPrice: true } },
    },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  if (current.saleId) {
    return { ok: true as const, id: current.saleId, replayed: true };
  }
  if (current.items.length === 0) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Add a product line before converting this quotation." };
  }
  if (!input.userId || !input.idempotencyKey) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "A user is required to convert the quotation." };
  }
  const sale = await postSale({
    organizationId: input.organizationId,
    branchId: input.branchId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    ip: input.ip ?? "127.0.0.1",
    userAgent: input.userAgent ?? null,
    businessDate: dateOnly(current.businessDate),
    customerId: current.customerId,
    paymentAmount: "0.00",
    allowPriceOverride: true,
    lines: current.items.map((line) => ({
      productId: line.productId,
      quantity: decimalString(line.quantity, 4),
      unitPrice: decimalString(line.unitPrice, 2),
    })),
    // The link to the quotation is written in the same transaction as the sale, so a
    // failure can never leave a sale behind that a second convert would duplicate.
    inTransaction: async (tx, created) => {
      const rows = await tx.$queryRaw<Array<{ saleId: string | null }>>`
        SELECT saleId FROM quotations
        WHERE id = ${current.id} AND organizationId = ${input.organizationId} AND branchId = ${input.branchId}
        FOR UPDATE
      `;
      if (!rows[0]) {
        throw new StockRuleError("That record was not found.", 404);
      }
      if (rows[0].saleId) {
        throw new StockRuleError("This quotation was already converted to a sale.", 409);
      }
      await tx.quotation.update({ where: { id: current.id }, data: { saleId: created.id, status: "ACCEPTED" } });
    },
  });
  if (!sale.ok) {
    return sale;
  }
  return { ok: true as const, id: sale.id, replayed: sale.replayed };
}
