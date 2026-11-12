import { Prisma } from "@prisma/client";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { moneyAccountFor } from "@/core/ledger/accounts";
import { invoicePayment } from "@/core/payments";
import { postWithStock } from "@/core/posting/stock";
import type { JournalLineInput } from "@/modules/accounting/post";
import { allocateNumber } from "@/modules/documents/numbers";
import { hashPayload, idempotentTransaction, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, money, parseQuantity, zero } from "@/core/money";
import { addExpiryLots, StockRuleError } from "@/modules/inventory/stock";
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

export type RefundMethod = "CASH" | "BANK" | "MOBILE" | "ADVANCE" | "AR_ONLY";

/**
 * What a return gives back (#21, #22): the sale's own lines in proportion (a line's discount and VAT share, the last unit takes the
 * rounding), the stock back at what it cost then (into the lots it came from), the sales and VAT reversed. What the customer still owed on
 * the invoice is cancelled first (the receivable); what they had already paid is refunded the way they paid (the default), to their
 * advance, or left as credit on their account (AR_ONLY).
 */
export async function postSaleReturn(
  input: Actor & { saleId: string; businessDate: string; refundMethod?: RefundMethod; refundAccountId?: string; lines: Array<{ saleItemId: string; quantity: string }> },
) {
  const requestHash = hashPayload({ saleId: input.saleId, businessDate: input.businessDate, refundMethod: input.refundMethod ?? null, refundAccountId: input.refundAccountId ?? null, lines: input.lines });
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
        select: { id: true, branchId: true, warehouseId: true, customerId: true, status: true, businessDate: true, payments: { select: { method: true, amount: true, accountId: true } }, customer: { select: { isSystem: true } } },
      });
      if (!sale || sale.branchId !== input.branchId) {
        throw new StockRuleError("That record was not found.", 404);
      }
      if (sale.status !== "POSTED" || !sale.warehouseId) {
        throw new StockRuleError("Only a posted sale can be returned.");
      }
      if (occurredDate(input.businessDate).getTime() < sale.businessDate.getTime()) {
        throw new StockRuleError("The return cannot be dated before the sale.");
      }
      if (new Set(input.lines.map((line) => line.saleItemId)).size !== input.lines.length) {
        throw new StockRuleError("Each sale line can appear once on a return.");
      }
      // the customer is locked first (a refund to the advance, and the receivable, are read after it)
      if (sale.customerId && !sale.customer?.isSystem) {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${sale.customerId} AND organizationId = ${input.organizationId} FOR UPDATE`;
      }
      const priced = [];
      for (const line of input.lines) {
        const quantity = parseQuantity(line.quantity);
        if (!quantity) {
          throw new StockRuleError("Enter a quantity greater than zero.");
        }
        const locked = await tx.$queryRaw<Array<{ id: string; productId: string; variantId: string | null; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; vatAmount: Prisma.Decimal; unitCost: Prisma.Decimal | null; lots: unknown }>>`
          SELECT id, productId, variantId, quantity, unitPrice, lineTotal, vatAmount, unitCost, lots FROM sale_items
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
        const amount = returnLineAmount({ sourceQuantity, unitAmount: new Prisma.Decimal(item.lineTotal).div(sourceQuantity), sourceTotal: new Prisma.Decimal(item.lineTotal), priorQuantities, quantity });
        const vat = returnLineAmount({ sourceQuantity, unitAmount: new Prisma.Decimal(item.vatAmount).div(sourceQuantity), sourceTotal: new Prisma.Decimal(item.vatAmount), priorQuantities, quantity });
        const unitCost = item.unitCost !== null ? new Prisma.Decimal(item.unitCost) : await saleUnitCost(tx, input.organizationId, sale.id, item.productId, item.variantId);
        priced.push({ saleItemId: item.id, productId: item.productId, variantId: item.variantId, quantity, amount, vat, unitCost, priorReturned: priorQuantities.reduce((sum, value) => sum.plus(value), zero()), lots: Array.isArray(item.lots) ? (item.lots as SoldLot[]) : [] });
      }
      const total = money(priced.reduce((sum, line) => sum.plus(line.amount), zero()));
      const vatTotal = money(priced.reduce((sum, line) => sum.plus(line.vat), zero()));
      const salesTotal = money(total.minus(vatTotal));

      // what the customer still owes on this invoice is cancelled first; the rest was paid, and is given back
      const bill = await invoicePayment(tx, input.organizationId, sale.id);
      const owedBefore = bill.owed;
      const original = defaultRefund(sale.payments);
      const method = input.refundMethod ?? original.method;
      const real = Boolean(sale.customerId && !sale.customer?.isSystem);
      if ((method === "ADVANCE" || method === "AR_ONLY") && !real) {
        throw new StockRuleError("Choose a customer's sale for an advance or an account credit; a Walk-in sale is refunded in cash.");
      }
      const applied = method === "AR_ONLY" ? total : money(Prisma.Decimal.min(total, owedBefore));
      const refund = money(total.minus(applied));
      const refundAccount =
        refund.gt(0) && method !== "ADVANCE" && method !== "AR_ONLY"
          ? await moneyAccountFor(tx, input.organizationId, { method: method === "CASH" ? "CASH" : "BANK", accountId: input.refundAccountId ?? (input.refundMethod ? undefined : (original.accountId ?? undefined)) })
          : null;
      if (refund.gt(0) && method === "MOBILE" && !input.refundAccountId && !(original.accountId && !input.refundMethod)) {
        throw new StockRuleError("Choose the mobile banking account the refund goes out of.");
      }
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "RET", businessDate: input.businessDate });
      const saleReturn = await tx.saleReturn.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          saleId: sale.id,
          number,
          status: "POSTED",
          businessDate: occurredDate(input.businessDate),
          total,
          refundMethod: refund.gt(0) || input.refundMethod ? method : null,
          refundAccountId: refundAccount,
          items: { create: priced.map((line) => ({ organizationId: input.organizationId, saleItemId: line.saleItemId, quantity: line.quantity })) },
        },
        select: { id: true, number: true },
      });
      const party = sale.customerId ? { type: "CUSTOMER" as const, id: sale.customerId } : undefined;
      const { journalId } = await postWithStock(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Sale return ${number}`,
        createdById: input.userId,
        doc: { type: "SALE_RETURN", id: saleReturn.id },
        reference: { type: "sale_return", id: saleReturn.id },
        moves: priced.map((line) => ({ productId: line.productId, variantId: line.variantId, warehouseId: sale.warehouseId as string, quantity: line.quantity, direction: "IN" as const, movementType: "CUSTOMER_RETURN" as const, unitCost: line.unitCost })),
        lines: (moved) => {
          const cost = moved.in;
          const journalLines: JournalLineInput[] = [
            ...(salesTotal.gt(0) ? [{ role: "SALES" as const, debit: salesTotal, credit: zero() }] : []),
            ...(vatTotal.gt(0) ? [{ role: "OUTPUT_VAT" as const, debit: vatTotal, credit: zero() }] : []),
            ...(applied.gt(0) ? [{ role: "AR" as const, debit: zero(), credit: applied, party }] : []),
            ...(refund.gt(0) && refundAccount ? [{ accountId: refundAccount, debit: zero(), credit: refund }] : []),
            ...(refund.gt(0) && method === "ADVANCE" && party ? [{ role: "CUSTOMER_ADVANCE" as const, debit: zero(), credit: refund, party }] : []),
            ...(cost.gt(0)
              ? [
                  { role: "INVENTORY" as const, debit: cost, credit: zero() },
                  { role: "COGS" as const, debit: zero(), credit: cost },
                ]
              : []),
          ];
          return journalLines.length >= 2 ? journalLines : [];
        },
      });
      // the stock goes back into the lots the sale took it from: the earliest sold lots first, less what earlier returns already put back
      for (const line of priced) {
        let skip = line.priorReturned;
        let left = line.quantity;
        for (const lot of line.lots) {
          if (left.lte(0)) {
            break;
          }
          const sold = new Prisma.Decimal(lot.quantity);
          const free = Prisma.Decimal.max(sold.minus(skip), 0);
          skip = Prisma.Decimal.max(skip.minus(sold), 0);
          const back = Prisma.Decimal.min(free, left);
          if (back.gt(0)) {
            left = left.minus(back);
            await addExpiryLots(tx, {
              organizationId: input.organizationId,
              branchId: input.branchId,
              warehouseId: sale.warehouseId as string,
              productId: line.productId,
              variantId: line.variantId ?? undefined,
              lots: [{ lot: lot.lot, expiresOn: occurredDate(lot.expiresOn), manufacturedOn: lot.manufacturedOn ? occurredDate(lot.manufacturedOn) : null, quantity: back }],
            });
          }
        }
      }
      if (journalId) {
        await tx.saleReturn.update({ where: { id: saleReturn.id }, data: { journalId } });
      }
      await saveIdempotency(tx, { organizationId: input.organizationId, userId: input.userId, key: input.idempotencyKey, requestHash, entityType: "sale_return", entityId: saleReturn.id });
      return { id: saleReturn.id, number: saleReturn.number, replayed: false, total: decimalString(total, 2) };
    });
    if (!data.replayed) {
      await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "return", module: "sales", entityType: "sale_return", entityId: data.id, after: { number: data.number }, ip: input.ip, userAgent: input.userAgent });
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

type SoldLot = { lot: string; expiresOn: string; manufacturedOn: string | null; quantity: string };

/** The way the customer paid, for the refund: the biggest payment of the sale, from the same account (the wallet comes back to the wallet). Cash when there was none. */
function defaultRefund(payments: Array<{ method: string; amount: Prisma.Decimal; accountId: string | null }>): { method: RefundMethod; accountId: string | null } {
  const biggest = [...payments].sort((a, b) => new Prisma.Decimal(b.amount).comparedTo(new Prisma.Decimal(a.amount)))[0];
  switch (biggest?.method) {
    case "WALLET":
      return { method: "ADVANCE", accountId: null };
    case "BANK":
    case "CARD":
      return { method: "BANK", accountId: biggest.accountId };
    case "MOBILE":
      return { method: "MOBILE", accountId: biggest.accountId };
    default:
      return { method: "CASH", accountId: biggest?.accountId ?? null };
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
