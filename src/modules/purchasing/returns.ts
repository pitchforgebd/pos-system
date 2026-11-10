import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { moneyAccountFor } from "@/core/ledger/accounts";
import type { JournalLineInput } from "@/modules/accounting/post";
import { postWithStock } from "@/core/posting/stock";
import { allocateNumber } from "@/modules/documents/numbers";
import { hashPayload, idempotentTransaction, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, money, parseQuantity, zero } from "@/core/money";
import { StockRuleError } from "@/modules/inventory/stock";
import { outstandingPayable } from "@/modules/purchasing/suppliers";
import { returnLineAmount } from "@/modules/returns/amount";
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

export async function postPurchaseReturn(
  input: Actor & {
    purchaseId: string;
    businessDate: string;
    refundMethod?: "CASH" | "BANK";
    lines: Array<{ purchaseItemId: string; quantity: string }>;
  },
) {
  const requestHash = hashPayload({
    purchaseId: input.purchaseId,
    businessDate: input.businessDate,
    refundMethod: input.refundMethod ?? null,
    lines: input.lines,
  });
  try {
    const data = await idempotentTransaction(async (tx) => {
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
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "RET", businessDate: input.businessDate });
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          purchaseId: purchase.id,
          number,
          status: "POSTED",
          businessDate: occurredDate(input.businessDate),
          total,
          items: { create: priced.map((line) => ({ organizationId: input.organizationId, purchaseItemId: line.purchaseItemId, quantity: line.quantity })) },
        },
        select: { id: true, number: true },
      });
      const refundAccount = await moneyAccountFor(tx, input.organizationId, { method: input.refundMethod ?? "CASH" });
      // The goods leave stock at the average cost; the vendor gives back the bill price. What the books carry for the stock (the
      // average) and what the vendor returns (the bill price) differ by the purchase price variance (N11, #16): Dr AP (bill price)
      // / Cr Inventory (average), the difference to PPV, so the inventory account still equals the stock x the average cost.
      const { journalId } = await postWithStock(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Purchase return ${number}`,
        createdById: input.userId,
        doc: { type: "PURCHASE_RETURN", id: purchaseReturn.id },
        reference: { type: "purchase_return", id: purchaseReturn.id },
        moves: priced.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          warehouseId: purchase.warehouseId as string,
          quantity: line.quantity,
          direction: "OUT" as const,
          movementType: "SUPPLIER_RETURN" as const,
        })),
        lines: (moved) => {
          const variance = money(total.minus(moved.out));
          const journalLines: JournalLineInput[] = [
            ...(applied.gt(0) ? [{ role: "AP" as const, debit: applied, credit: zero(), party: { type: "VENDOR" as const, id: purchase.supplierId } }] : []),
            ...(refund.gt(0) ? [{ accountId: refundAccount, debit: refund, credit: zero() }] : []),
            ...(moved.out.gt(0) ? [{ role: "INVENTORY" as const, debit: zero(), credit: moved.out }] : []),
            // more back from the vendor than the stock carried: a gain; less: a loss
            ...(variance.gt(0) ? [{ role: "PPV" as const, debit: zero(), credit: variance }] : []),
            ...(variance.lt(0) ? [{ role: "PPV" as const, debit: variance.neg(), credit: zero() }] : []),
          ];
          return journalLines.length >= 2 ? journalLines : [];
        },
      });
      if (journalId) {
        await tx.purchaseReturn.update({ where: { id: purchaseReturn.id }, data: { journalId } });
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
    orderBy: { businessDate: "desc" },
    take: 50,
    select: { id: true, number: true, status: true, total: true, businessDate: true, purchase: { select: { number: true, supplier: { select: { name: true } } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    total: decimalString(row.total, 2),
    businessDate: dateOnly(row.businessDate),
    source: row.purchase.number,
    supplierName: row.purchase.supplier.name,
  }));
}

export async function listReturnablePurchaseLines(organizationId: string, branchId: string) {
  const rows = await prisma.purchaseItem.findMany({
    where: { organizationId, purchase: { branchId, status: "POSTED" } },
    orderBy: { purchase: { businessDate: "desc" } },
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
