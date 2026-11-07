import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { postBalancedJournal } from "@/modules/accounting/post";
import { outstandingReceivable } from "@/modules/customers/customers";
import { allocateNumber, documentYear } from "@/modules/documents/numbers";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, money, parseQuantity, zero } from "@/core/money";
import { applyMovement, StockRuleError } from "@/modules/inventory/stock";
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
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

export async function postSaleReturn(
  input: Actor & { saleId: string; businessDate: string; lines: Array<{ saleItemId: string; quantity: string }> },
) {
  const requestHash = hashPayload({ saleId: input.saleId, businessDate: input.businessDate, lines: input.lines });
  try {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null, total: null as string | null };
      }
      const sale = await tx.sale.findFirst({
        where: { id: input.saleId, organizationId: input.organizationId },
        select: { id: true, branchId: true, warehouseId: true, customerId: true, status: true },
      });
      if (!sale || sale.branchId !== input.branchId) {
        throw new StockRuleError("That record was not found.", 404);
      }
      if (sale.status !== "POSTED" || !sale.warehouseId) {
        throw new StockRuleError("Only a posted sale can be returned.");
      }
      if (new Set(input.lines.map((line) => line.saleItemId)).size !== input.lines.length) {
        throw new StockRuleError("Each sale line can appear once on a return.");
      }
      const priced = [];
      for (const line of input.lines) {
        const quantity = parseQuantity(line.quantity);
        if (!quantity) {
          throw new StockRuleError("Enter a quantity greater than zero.");
        }
        const locked = await tx.$queryRaw<Array<{ id: string; productId: string; variantId: string | null; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; vatAmount: Prisma.Decimal }>>`
          SELECT id, productId, variantId, quantity, unitPrice, lineTotal, vatAmount FROM sale_items
          WHERE id = ${line.saleItemId} AND saleId = ${sale.id} AND organizationId = ${input.organizationId}
          FOR UPDATE
        `;
        const item = locked[0];
        if (!item) {
          throw new StockRuleError("That record was not found.", 404);
        }
        const prior = await tx.saleReturnItem.findMany({
          where: { saleItemId: item.id, saleReturn: { status: "POSTED" } },
          orderBy: [{ saleReturn: { createdAt: "asc" } }, { id: "asc" }],
          select: { quantity: true },
        });
        // What the customer paid for the line (after discount, VAT included) is shared by quantity.
        // The line total and its VAT are split separately so the sales credit and the VAT payable
        // are each reversed by their own share. The last unit takes the rounding remainder.
        const sourceQuantity = new Prisma.Decimal(item.quantity);
        const priorQuantities = prior.map((row) => new Prisma.Decimal(row.quantity));
        const amount = returnLineAmount({
          sourceQuantity,
          unitAmount: new Prisma.Decimal(item.lineTotal).div(sourceQuantity),
          sourceTotal: new Prisma.Decimal(item.lineTotal),
          priorQuantities,
          quantity,
        });
        const vat = returnLineAmount({
          sourceQuantity,
          unitAmount: new Prisma.Decimal(item.vatAmount).div(sourceQuantity),
          sourceTotal: new Prisma.Decimal(item.vatAmount),
          priorQuantities,
          quantity,
        });
        const unitCost = await saleUnitCost(tx, input.organizationId, sale.id, item.productId, item.variantId);
        const cost = returnLineAmount({
          sourceQuantity: new Prisma.Decimal(item.quantity),
          unitAmount: unitCost,
          sourceTotal: money(new Prisma.Decimal(item.quantity).mul(unitCost)),
          priorQuantities: prior.map((row) => new Prisma.Decimal(row.quantity)),
          quantity,
        });
        priced.push({ saleItemId: item.id, productId: item.productId, variantId: item.variantId, quantity, amount, vat, unitCost, cost });
      }
      const total = money(priced.reduce((sum, line) => sum.plus(line.amount), zero()));
      const vatTotal = money(priced.reduce((sum, line) => sum.plus(line.vat), zero()));
      const salesTotal = money(total.minus(vatTotal));
      const cost = money(priced.reduce((sum, line) => sum.plus(line.cost), zero()));
      const split = await receivableSplit(tx, input.organizationId, sale.customerId, total);
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "RET", year: documentYear(input.businessDate) });
      const saleReturn = await tx.saleReturn.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          saleId: sale.id,
          number,
          status: "POSTED",
          businessDate: occurredDate(input.businessDate),
          total,
          items: { create: priced.map((line) => ({ organizationId: input.organizationId, saleItemId: line.saleItemId, quantity: line.quantity })) },
        },
        select: { id: true, number: true },
      });
      for (const line of priced) {
        await applyMovement(tx, {
          organizationId: input.organizationId,
          productId: line.productId,
          variantId: line.variantId,
          branchId: input.branchId,
          warehouseId: sale.warehouseId,
          quantity: line.quantity,
          direction: "IN",
          movementType: "CUSTOMER_RETURN",
          referenceType: "sale_return",
          referenceId: saleReturn.id,
          userId: input.userId,
          unitCost: line.unitCost,
        });
      }
      const journalLines = [
        ...(salesTotal.gt(0) ? [{ accountCode: "4100", debit: salesTotal, credit: zero() }] : []),
        ...(vatTotal.gt(0) ? [{ accountCode: "2300", debit: vatTotal, credit: zero() }] : []),
        ...(split.applied.gt(0) ? [{ accountCode: "1300", debit: zero(), credit: split.applied }] : []),
        ...(split.refund.gt(0) ? [{ accountCode: "1100", debit: zero(), credit: split.refund }] : []),
        ...(cost.gt(0)
          ? [
              { accountCode: "1400", debit: cost, credit: zero() },
              { accountCode: "5100", debit: zero(), credit: cost },
            ]
          : []),
      ];
      if (journalLines.length > 0) {
        const journalId = await postBalancedJournal(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: occurredDate(input.businessDate),
          description: `Sale return ${number}`,
          createdById: input.userId,
          lines: journalLines,
        });
        await tx.saleReturn.update({ where: { id: saleReturn.id }, data: { journalId } });
      }
      if (sale.customerId && split.applied.gt(0)) {
        await tx.customerLedger.create({
          data: {
            organizationId: input.organizationId,
            branchId: input.branchId,
            customerId: sale.customerId,
            businessDate: occurredDate(input.businessDate),
            entryType: "RETURN",
            credit: split.applied,
            referenceType: "sale_return",
            referenceId: saleReturn.id,
          },
        });
      }
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "sale_return",
        entityId: saleReturn.id,
      });
      return { id: saleReturn.id, number: saleReturn.number, replayed: false, total: decimalString(total, 2) };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "return",
        module: "sales",
        entityType: "sale_return",
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

async function saleUnitCost(tx: Prisma.TransactionClient, organizationId: string, saleId: string, productId: string, variantId: string | null) {
  const rows = await tx.stockLedger.findMany({
    where: { organizationId, referenceType: "sale", referenceId: saleId, productId, variantId, direction: "OUT", movementType: "SALE" },
    select: { unitCost: true },
  });
  const first = rows[0]?.unitCost;
  if (first === null || first === undefined || rows.some((row) => row.unitCost === null || !new Prisma.Decimal(row.unitCost ?? 0).eq(first))) {
    throw new StockRuleError("This return has no single unit cost on the original sale.");
  }
  return new Prisma.Decimal(first);
}

async function receivableSplit(tx: Prisma.TransactionClient, organizationId: string, customerId: string | null, total: Prisma.Decimal) {
  if (!customerId || total.eq(0)) {
    return { applied: zero(), refund: total };
  }
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} AND organizationId = ${organizationId} FOR UPDATE`;
  const outstanding = await outstandingReceivable(organizationId, customerId, tx);
  const applied = money(Prisma.Decimal.min(total, outstanding.gt(0) ? outstanding : zero()));
  return { applied, refund: money(total.minus(applied)) };
}

export async function listSaleReturns(organizationId: string, branchId: string) {
  const rows = await prisma.saleReturn.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 50,
    select: { id: true, number: true, status: true, total: true, businessDate: true, sale: { select: { invoice: { select: { number: true } } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    total: decimalString(row.total, 2),
    businessDate: dateOnly(row.businessDate),
    source: row.sale.invoice?.number ?? "Sale",
  }));
}

export async function listReturnableSaleLines(organizationId: string, branchId: string) {
  const rows = await prisma.saleItem.findMany({
    where: { organizationId, sale: { branchId, status: "POSTED" } },
    orderBy: { sale: { businessDate: "desc" } },
    take: 100,
    select: {
      id: true,
      saleId: true,
      quantity: true,
      product: { select: { sku: true, name: true } },
      sale: { select: { invoice: { select: { number: true } } } },
      returnItems: { where: { saleReturn: { status: "POSTED" } }, select: { quantity: true } },
    },
  });
  return rows.flatMap((row) => {
    const returned = row.returnItems.reduce((sum, item) => sum.plus(item.quantity), zero());
    const eligible = new Prisma.Decimal(row.quantity).minus(returned);
    if (eligible.lte(0)) {
      return [];
    }
    return [{
      saleId: row.saleId,
      itemId: row.id,
      label: `${row.sale.invoice?.number ?? "Sale"} · ${row.product.sku} · ${row.product.name} · eligible ${decimalString(eligible, 4)}`,
    }];
  });
}
