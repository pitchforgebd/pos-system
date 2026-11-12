import { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { moneyAccountFor } from "@/core/ledger/accounts";
import { decimalString, money, parseMoney, parseQuantity, zero } from "@/core/money";
import { postWithStock } from "@/core/posting/stock";
import { dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { occurredDate } from "@/lib/format/date";
import { writeAudit } from "@/modules/auth/audit";
import { verifyPassword } from "@/modules/auth/password";
import { allocateNumber } from "@/modules/documents/numbers";
import { StockRuleError } from "@/modules/inventory/stock";
import { resolvePrice } from "@/modules/pricing";
import { failure, type Actor } from "@/modules/purchasing/common";
import type { PostLine } from "@/core/posting/journal";

// A return with no invoice (P06 task 8, N10): the customer has no receipt. It needs the returns.without_invoice permission and a second
// user's approval (their login and password, typed at the counter), refunds at most the current retail price, splits the VAT out, takes the
// stock back at what it costs now (the average), and leaves its own journal: Dr Sales, Dr Output VAT / Cr the money account;
// Dr Inventory / Cr Cost of goods sold. No receivable is touched: nothing was owed on an invoice that does not exist.

type Tx = Prisma.TransactionClient;
const PERMISSION = "returns.without_invoice";

export type ReceiptlessInput = Actor & {
  businessDate: string;
  customerId?: string;
  reason: string;
  refundMethod: "CASH" | "BANK" | "MOBILE";
  refundAccountId?: string;
  approver: { email: string; password: string };
  lines: Array<{ productId: string; variantId?: string; quantity: string; unitRefund?: string }>;
};

/** The second user: another active user of the shop, with the permission, whose password is right. A wrong answer says nothing about why. */
async function approverOf(tx: Tx, input: ReceiptlessInput) {
  const refused = new RuleError("The approval is not valid.");
  const user = await tx.user.findFirst({ where: { organizationId: input.organizationId, email: input.approver.email.trim().toLowerCase(), status: "ACTIVE" }, select: { id: true, passwordHash: true } });
  if (!user || !(await verifyPassword(input.approver.password, user.passwordHash)) || user.id === input.userId) {
    throw refused;
  }
  const links = await tx.userRole.findMany({ where: { userId: user.id }, select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } });
  if (!links.some((link) => link.role.permissions.some((row) => row.permission.code === PERMISSION))) {
    throw refused;
  }
  return user.id;
}

/** What a unit of the product sells for now at the default (Retail) level: the most a return with no invoice may refund. */
async function currentRetail(tx: Tx, organizationId: string, productId: string, variantId: string | undefined, fallback: Prisma.Decimal) {
  const picked = await resolvePrice(tx, { organizationId, productId, variantId, quantity: "1.0000" });
  return picked ? picked.price : fallback;
}

export function postReceiptlessReturn(input: ReceiptlessInput) {
  const requestHash = hashPayload({ businessDate: input.businessDate, customerId: input.customerId ?? null, reason: input.reason, refundMethod: input.refundMethod, refundAccountId: input.refundAccountId ?? null, approver: input.approver.email.trim().toLowerCase(), lines: input.lines });
  return (async () => {
    try {
      const data = await idempotentTransaction(async (tx) => {
        const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
        if (existing === "mismatch") {
          throw new StockRuleError("This idempotency key was already used for a different request.", 409);
        }
        if (existing) {
          const row = await tx.receiptlessReturn.findFirst({ where: { id: existing.entityId, organizationId: input.organizationId }, select: { id: true, number: true, total: true } });
          return { id: existing.entityId, number: row?.number ?? null, total: row ? decimalString(row.total, 2) : null, replayed: true };
        }
        const reason = input.reason.trim();
        if (reason.length < 3) {
          throw new RuleError("Say why the goods are coming back.");
        }
        if (input.lines.length === 0) {
          throw new RuleError("Add a line to the return.");
        }
        const approvedById = await approverOf(tx, input);
        if (input.customerId && !(await tx.customer.findFirst({ where: { id: input.customerId, organizationId: input.organizationId }, select: { id: true } }))) {
          throw new RuleError("That record was not found.", 404);
        }
        const warehouse = await tx.warehouse.findFirst({ where: { organizationId: input.organizationId, branchId: input.branchId, status: "ACTIVE", ...(input.warehouseId ? { id: input.warehouseId } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true } });
        if (!warehouse) {
          throw new RuleError("Choose an active warehouse on the current branch.");
        }

        const priced = [];
        for (const line of input.lines) {
          const quantity = parseQuantity(line.quantity);
          if (!quantity) {
            throw new RuleError("Enter a quantity greater than zero.");
          }
          const product = await tx.product.findFirst({ where: { id: line.productId, organizationId: input.organizationId, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true, sellingPrice: true, vatType: true, vatValue: true, trackStock: true, trackExpiry: true, trackSerial: true } });
          if (!product || !product.trackStock) {
            throw new RuleError("That record was not found.", 404);
          }
          if (product.trackExpiry || product.trackSerial) {
            throw new RuleError(`${product.name} is tracked by lot or serial number: take it back against its invoice.`);
          }
          const retail = money(await currentRetail(tx, input.organizationId, product.id, line.variantId, new Prisma.Decimal(product.sellingPrice)));
          const offered = line.unitRefund ? parseMoney(line.unitRefund) : retail;
          if (!offered || offered.lte(0)) {
            throw new RuleError("Enter the refund price with up to two decimals.");
          }
          if (offered.gt(retail)) {
            throw new RuleError(`${product.name} can be refunded at most at its current retail price, ${decimalString(retail, 2)}.`);
          }
          const net = money(quantity.mul(offered));
          const rate = product.vatValue !== null && product.vatType ? new Prisma.Decimal(product.vatValue) : zero();
          const type = (product.vatType ?? "").toUpperCase();
          // an inclusive price already has its VAT in it; an exclusive (net) price has it added on top
          const vat = rate.lte(0) ? zero() : type === "INCLUSIVE" ? money(net.minus(money(net.div(rate.div(100).plus(1))))) : type === "EXCLUSIVE" || type === "PERCENT" ? money(net.mul(rate).div(100)) : zero();
          const lineTotal = type === "EXCLUSIVE" || type === "PERCENT" ? money(net.plus(vat)) : net;
          priced.push({ productId: product.id, variantId: line.variantId, quantity, unitRefund: offered, vat, lineTotal });
        }
        const total = money(priced.reduce((sum, line) => sum.plus(line.lineTotal), zero()));
        const vatTotal = money(priced.reduce((sum, line) => sum.plus(line.vat), zero()));
        if (input.refundMethod === "MOBILE" && !input.refundAccountId) {
          throw new RuleError("Choose the mobile banking account the refund goes out of.");
        }
        const refundAccount = await moneyAccountFor(tx, input.organizationId, { method: input.refundMethod === "CASH" ? "CASH" : "BANK", accountId: input.refundAccountId });

        const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "RET", businessDate: input.businessDate });
        const row = await tx.receiptlessReturn.create({
          data: {
            organizationId: input.organizationId,
            branchId: input.branchId,
            customerId: input.customerId ?? null,
            number,
            businessDate: occurredDate(input.businessDate),
            total,
            vatTotal,
            refundMethod: input.refundMethod,
            refundAccountId: refundAccount,
            reason,
            approvedById,
            createdById: input.userId,
          },
          select: { id: true },
        });
        const { journalId, moved } = await postWithStock(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: occurredDate(input.businessDate),
          description: `Return without invoice ${number}`,
          createdById: input.userId,
          doc: { type: "SALE_RETURN", id: row.id },
          reference: { type: "receiptless_return", id: row.id },
          moves: priced.map((line) => ({ productId: line.productId, variantId: line.variantId, warehouseId: warehouse.id, quantity: line.quantity, direction: "IN" as const, movementType: "CUSTOMER_RETURN" as const })),
          lines: (result) => {
            const salesDebit = money(total.minus(vatTotal));
            const journal: PostLine[] = [
              ...(salesDebit.gt(0) ? [{ role: "SALES" as const, debit: salesDebit, credit: zero() }] : []),
              ...(vatTotal.gt(0) ? [{ role: "OUTPUT_VAT" as const, debit: vatTotal, credit: zero() }] : []),
              { accountId: refundAccount, debit: zero(), credit: total },
              ...(result.in.gt(0)
                ? [
                    { role: "INVENTORY" as const, debit: result.in, credit: zero() },
                    { role: "COGS" as const, debit: zero(), credit: result.in },
                  ]
                : []),
            ];
            return journal;
          },
        });
        await tx.receiptlessReturnItem.createMany({
          data: priced.map((line, index) => ({ organizationId: input.organizationId, returnId: row.id, productId: line.productId, variantId: line.variantId ?? null, quantity: line.quantity, unitRefund: line.unitRefund, vatAmount: line.vat, unitCost: moved.results[index].unitCost, lineTotal: line.lineTotal })),
        });
        await tx.receiptlessReturn.update({ where: { id: row.id }, data: { journalId } });
        await saveIdempotency(tx, { organizationId: input.organizationId, userId: input.userId, key: input.idempotencyKey, requestHash, entityType: "receiptless_return", entityId: row.id });
        return { id: row.id, number: number as string | null, total: decimalString(total, 2) as string | null, replayed: false, approvedById };
      });
      if (!data.replayed && "approvedById" in data) {
        await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "return-without-invoice", module: "sales", entityType: "receiptless_return", entityId: data.id, after: { number: data.number, total: data.total, approvedById: data.approvedById }, ip: input.ip, userAgent: input.userAgent });
      }
      return { ok: true as const, id: data.id, number: data.number, total: data.total, replayed: data.replayed };
    } catch (error) {
      const mapped = failure(error);
      if (mapped) {
        return mapped;
      }
      throw error;
    }
  })();
}

export async function listReceiptlessReturns(organizationId: string, branchId: string) {
  const rows = await prisma.receiptlessReturn.findMany({ where: { organizationId, branchId }, orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }], take: 50, select: { id: true, number: true, businessDate: true, total: true, reason: true, refundMethod: true } });
  return rows.map((row) => ({ id: row.id, number: row.number, businessDate: dateOnly(row.businessDate), total: decimalString(row.total, 2), reason: row.reason, refundMethod: row.refundMethod }));
}
