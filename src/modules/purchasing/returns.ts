import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { PostingError, postBalancedJournal } from "@/modules/accounting/post";
import { allocateNumber, documentYear } from "@/modules/documents/numbers";
import { hashPayload, readIdempotency, saveIdempotency } from "@/modules/inventory/idempotency";
import { decimalString, parseQuantity } from "@/modules/inventory/money";
import { applyMovement, StockRuleError } from "@/modules/inventory/stock";
import { outstandingPayable } from "@/modules/purchasing/suppliers";
import { returnLineAmount } from "@/modules/returns/amount";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
};

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2);
}

function zero() {
  return new Prisma.Decimal(0);
}

function occurredDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function failure(error: unknown): Failure | null {
  if (error instanceof StockRuleError || error instanceof PostingError) {
    const status = error instanceof StockRuleError ? error.status : 422;
    return {
      ok: false,
      status,
      code: status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "BUSINESS_RULE",
      message: error.message,
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

export async function postPurchaseReturn(
  input: Actor & {
    purchaseId: string;
    occurredOn: string;
    refundMethod?: "CASH" | "BANK";
    lines: Array<{ purchaseItemId: string; quantity: string }>;
  },
) {
  const requestHash = hashPayload({
    purchaseId: input.purchaseId,
    occurredOn: input.occurredOn,
    refundMethod: input.refundMethod ?? null,
    lines: input.lines,
  });
  try {
    const data = await prisma.$transaction(async (tx) => {
      const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null, total: null as string | null };
      }
      const purchase = await tx.purchase.findFirst({
        where: { id: input.purchaseId, organizationId: input.organizationId },
        select: { id: true, branchId: true, warehouseId: true, supplierId: true, status: true },
      });
      if (!purchase || purchase.branchId !== input.branchId) {
        throw new StockRuleError("That record was not found.", 404);
      }
      if (purchase.status !== "POSTED" || !purchase.warehouseId) {
        throw new StockRuleError("Only a posted purchase can be returned.");
      }
      if (new Set(input.lines.map((line) => line.purchaseItemId)).size !== input.lines.length) {
        throw new StockRuleError("Each purchase line can appear once on a return.");
      }
      const priced = [];
      for (const line of input.lines) {
        const quantity = parseQuantity(line.quantity);
        if (!quantity) {
          throw new StockRuleError("Enter a quantity greater than zero.");
        }
        const locked = await tx.$queryRaw<Array<{ id: string; productId: string; variantId: string | null; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; lineTotal: Prisma.Decimal }>>`
          SELECT id, productId, variantId, quantity, unitCost, lineTotal FROM purchase_items
          WHERE id = ${line.purchaseItemId} AND purchaseId = ${purchase.id} AND organizationId = ${input.organizationId}
          FOR UPDATE
        `;
        const item = locked[0];
        if (!item) {
          throw new StockRuleError("That record was not found.", 404);
        }
        const prior = await tx.purchaseReturnItem.findMany({
          where: { purchaseItemId: item.id, purchaseReturn: { status: "POSTED" } },
          orderBy: [{ purchaseReturn: { createdAt: "asc" } }, { id: "asc" }],
          select: { quantity: true },
        });
        const amount = returnLineAmount({
          sourceQuantity: new Prisma.Decimal(item.quantity),
          unitAmount: new Prisma.Decimal(item.unitCost),
          sourceTotal: new Prisma.Decimal(item.lineTotal),
          priorQuantities: prior.map((row) => new Prisma.Decimal(row.quantity)),
          quantity,
        });
        priced.push({ purchaseItemId: item.id, productId: item.productId, variantId: item.variantId, quantity, amount, unitCost: new Prisma.Decimal(item.unitCost) });
      }
      const total = money(priced.reduce((sum, line) => sum.plus(line.amount), zero()));
      await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${purchase.supplierId} AND organizationId = ${input.organizationId} FOR UPDATE`;
      const outstanding = await outstandingPayable(input.organizationId, purchase.supplierId, tx);
      const applied = money(Prisma.Decimal.min(total, outstanding.gt(0) ? outstanding : zero()));
      const refund = money(total.minus(applied));
      if (refund.gt(0) && input.refundMethod !== "CASH" && input.refundMethod !== "BANK") {
        throw new StockRuleError("Choose cash or bank for the supplier refund.");
      }
      if (refund.eq(0) && input.refundMethod) {
        throw new StockRuleError("A refund method is only used when the return exceeds the outstanding payable.");
      }
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "RET", year: documentYear(input.occurredOn) });
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          purchaseId: purchase.id,
          number,
          status: "POSTED",
          occurredOn: occurredDate(input.occurredOn),
          total,
          items: { create: priced.map((line) => ({ organizationId: input.organizationId, purchaseItemId: line.purchaseItemId, quantity: line.quantity })) },
        },
        select: { id: true, number: true },
      });
      for (const line of priced) {
        await applyMovement(tx, {
          organizationId: input.organizationId,
          productId: line.productId,
          variantId: line.variantId,
          branchId: input.branchId,
          warehouseId: purchase.warehouseId,
          quantity: line.quantity,
          direction: "OUT",
          movementType: "SUPPLIER_RETURN",
          referenceType: "purchase_return",
          referenceId: purchaseReturn.id,
          userId: input.userId,
          unitCost: line.unitCost,
        });
      }
      const cashCode = input.refundMethod === "BANK" ? "1200" : "1100";
      const journalLines = [
        ...(applied.gt(0) ? [{ accountCode: "2100", debit: applied, credit: zero() }] : []),
        ...(refund.gt(0) ? [{ accountCode: cashCode, debit: refund, credit: zero() }] : []),
        ...(total.gt(0) ? [{ accountCode: "1400", debit: zero(), credit: total }] : []),
      ];
      if (journalLines.length > 0) {
        const journalId = await postBalancedJournal(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          occurredOn: occurredDate(input.occurredOn),
          description: `Purchase return ${number}`,
          createdById: input.userId,
          lines: journalLines,
        });
        await tx.purchaseReturn.update({ where: { id: purchaseReturn.id }, data: { journalId } });
      }
      if (applied.gt(0)) {
        await tx.supplierLedger.create({
          data: {
            organizationId: input.organizationId,
            branchId: input.branchId,
            supplierId: purchase.supplierId,
            occurredOn: occurredDate(input.occurredOn),
            entryType: "RETURN",
            debit: applied,
            referenceType: "purchase_return",
            referenceId: purchaseReturn.id,
          },
        });
      }
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "purchase_return",
        entityId: purchaseReturn.id,
      });
      return { id: purchaseReturn.id, number: purchaseReturn.number, replayed: false, total: decimalString(total, 2) };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "return",
        module: "purchases",
        entityType: "purchase_return",
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

export async function listPurchaseReturns(organizationId: string, branchId: string) {
  const rows = await prisma.purchaseReturn.findMany({
    where: { organizationId, branchId },
    orderBy: { occurredOn: "desc" },
    take: 50,
    select: { id: true, number: true, status: true, total: true, occurredOn: true, purchase: { select: { number: true, supplier: { select: { name: true } } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    total: decimalString(row.total, 2),
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    source: row.purchase.number,
    supplierName: row.purchase.supplier.name,
  }));
}

export async function listReturnablePurchaseLines(organizationId: string, branchId: string) {
  const rows = await prisma.purchaseItem.findMany({
    where: { organizationId, purchase: { branchId, status: "POSTED" } },
    orderBy: { purchase: { occurredOn: "desc" } },
    take: 100,
    select: {
      id: true,
      purchaseId: true,
      quantity: true,
      product: { select: { sku: true, name: true } },
      purchase: { select: { number: true } },
      returnItems: { where: { purchaseReturn: { status: "POSTED" } }, select: { quantity: true } },
    },
  });
  return rows.flatMap((row) => {
    const returned = row.returnItems.reduce((sum, item) => sum.plus(item.quantity), zero());
    const eligible = new Prisma.Decimal(row.quantity).minus(returned);
    if (eligible.lte(0)) {
      return [];
    }
    return [{
      purchaseId: row.purchaseId,
      itemId: row.id,
      label: `${row.purchase.number ?? "Purchase"} · ${row.product.sku} · ${row.product.name} · eligible ${decimalString(eligible, 4)}`,
    }];
  });
}
