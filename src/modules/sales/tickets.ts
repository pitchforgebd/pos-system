import { Prisma } from "@prisma/client";
import { runTx } from "@/core/tx/run";
import { RuleError } from "@/core/errors/rule-error";
import { businessDate } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { hashPayload, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, parseQuantity } from "@/core/money";
import { StockRuleError } from "@/modules/inventory/stock";

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  idempotencyKey: string;
};

export async function holdTicket(
  input: Actor & { customerId?: string; lines: Array<{ productId: string; variantId?: string; quantity: string }> },
) {
  const requestHash = hashPayload({ customerId: input.customerId ?? null, lines: input.lines });
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
        return { id: existing.entityId, replayed: true };
      }
      if (input.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: input.customerId, organizationId: input.organizationId, status: "ACTIVE" },
          select: { id: true },
        });
        if (!customer) {
          throw new StockRuleError("That record was not found.", 404);
        }
      }
      const lines = [];
      for (const line of input.lines) {
        const quantity = parseQuantity(line.quantity);
        const product = await tx.product.findFirst({
          where: { id: line.productId, organizationId: input.organizationId, deletedAt: null, status: "ACTIVE" },
          select: { id: true, sellingPrice: true },
        });
        if (!quantity || !product) {
          throw new StockRuleError("Enter a quantity greater than zero for an active product.");
        }
        lines.push({ productId: product.id, variantId: line.variantId ?? null, quantity, unitPrice: product.sellingPrice });
      }
      const ticket = await tx.heldTicket.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          userId: input.userId,
          customerId: input.customerId ?? null,
          items: {
            create: lines.map((line) => ({
              organizationId: input.organizationId,
              productId: line.productId,
              variantId: line.variantId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
            })),
          },
        },
        select: { id: true },
      });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "held_ticket",
        entityId: ticket.id,
      });
      return { id: ticket.id, replayed: false };
    });
    return { ok: true as const, ...data, warnings: await stockWarnings(input.organizationId, input.branchId, input.lines) };
  } catch (error) {
    if (error instanceof RuleError) {
      return {
        ok: false as const,
        status: error.status,
        code: error.status === 404 ? ("NOT_FOUND" as const) : error.status === 409 ? ("CONFLICT" as const) : ("BUSINESS_RULE" as const),
        message: error.message,
      };
    }
    throw error;
  }
}

export async function listHeldTickets(organizationId: string, branchId: string) {
  const rows = await prisma.heldTicket.findMany({
    where: { organizationId, branchId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      customer: { select: { name: true } },
      items: { select: { quantity: true, unitPrice: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    createdOn: businessDate(row.createdAt),
    customerName: row.customer?.name ?? "Walk-in",
    lines: row.items.length,
    previewTotal: decimalString(
      row.items.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.quantity).mul(item.unitPrice)), new Prisma.Decimal(0)),
      2,
    ),
  }));
}

export async function discardHeldTicket(organizationId: string, branchId: string, id: string) {
  const ticket = await prisma.heldTicket.findFirst({ where: { id, organizationId, branchId }, select: { id: true } });
  if (!ticket) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  await prisma.heldTicket.delete({ where: { id: ticket.id } });
  return { ok: true as const };
}

/** B7: holding a ticket does not hold stock. If what is on it is more than what is available now, say so (the ticket is still held). */
export async function stockWarnings(organizationId: string, branchId: string, lines: Array<{ productId: string; variantId?: string; quantity: string }>) {
  const warnings: string[] = [];
  for (const line of lines) {
    const quantity = parseQuantity(line.quantity);
    if (!quantity) {
      continue;
    }
    const product = await prisma.product.findFirst({ where: { id: line.productId, organizationId }, select: { name: true, trackStock: true } });
    if (!product?.trackStock) {
      continue;
    }
    const rows = await prisma.stockBalance.findMany({ where: { organizationId, branchId, productId: line.productId, variantScope: line.variantId ?? "" }, select: { quantity: true, reservedQty: true } });
    const available = rows.reduce((sum, row) => sum.plus(row.quantity).minus(row.reservedQty), new Prisma.Decimal(0));
    if (available.lt(quantity)) {
      warnings.push(`${product.name}: ${decimalString(Prisma.Decimal.max(available, 0), 4)} available, ${decimalString(quantity, 4)} on the ticket`);
    }
  }
  return warnings;
}

/** A held ticket with its lines and what is available now, for resuming it at the register. */
export async function getHeldTicket(organizationId: string, branchId: string, id: string) {
  const row = await prisma.heldTicket.findFirst({
    where: { id, organizationId, branchId },
    include: { customer: { select: { id: true, name: true, phone: true } }, items: { include: { product: { select: { sku: true, name: true } } } } },
  });
  if (!row) {
    return null;
  }
  const warnings = await stockWarnings(organizationId, branchId, row.items.map((item) => ({ productId: item.productId, variantId: item.variantId ?? undefined, quantity: item.quantity.toFixed(4) })));
  return {
    id: row.id,
    customer: row.customer,
    lines: row.items.map((item) => ({ productId: item.productId, variantId: item.variantId, label: `${item.product.sku} · ${item.product.name}`, quantity: decimalString(item.quantity, 4) })),
    warnings,
  };
}
