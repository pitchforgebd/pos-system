import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { RuleError } from "@/core/errors/rule-error";
import { moneyAccountFor } from "@/core/ledger/accounts";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { parseMoney } from "@/core/money";
import { partyBalance } from "@/core/parties";
import { allocatePayment } from "@/core/payments";
import { postBalancedJournal } from "@/modules/accounting/post";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { StockRuleError } from "@/modules/inventory/stock";
import { amountOf, failure, type Actor } from "@/modules/purchasing/common";
import { occurredDate } from "@/lib/format/date";

// Paying a vendor (P05 tasks 5 and 6): a payment from a cash, bank or mobile account (with the bank's or the mobile service's charge),
// settling named bills or the oldest debt; money paid ahead (an advance); and the advance used against bills.

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

/** The money account a payment comes out of, and what kind it is (it says which charge account a fee goes to). */
async function moneyOf(tx: Tx, organizationId: string, method: string, accountId?: string) {
  if (method === "MOBILE" && !accountId) {
    throw new RuleError("Choose the mobile banking account.");
  }
  const id = await moneyAccountFor(tx, organizationId, { method, accountId });
  const account = await tx.account.findUniqueOrThrow({ where: { id }, select: { kind: true } });
  return { id, kind: account.kind as "CASH" | "BANK" | "MOBILE" };
}

/** One payment to a vendor: its journal (Dr payable [+ Dr bank/mobile charge] / Cr the money account) and its document. */
export async function settleSupplier(
  tx: Tx,
  input: Actor & { supplierId: string; businessDate: string; amount: Prisma.Decimal; method: string; accountId?: string; charge?: Prisma.Decimal; purchaseId?: string },
) {
  const charge = input.charge ?? ZERO;
  const money = await moneyOf(tx, input.organizationId, input.method, input.accountId);
  if (charge.gt(0) && money.kind === "CASH") {
    throw new RuleError("A cash payment has no bank or mobile charge.");
  }
  const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "PAY", businessDate: input.businessDate });
  const paymentId = randomUUID();
  const journalId = await postBalancedJournal(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    businessDate: occurredDate(input.businessDate),
    description: `Supplier payment ${number}`,
    createdById: input.userId,
    doc: { type: "SUPPLIER_PAYMENT", id: paymentId },
    lines: [
      { role: "AP", debit: input.amount, credit: ZERO, party: { type: "VENDOR" as const, id: input.supplierId } },
      ...(charge.gt(0) ? [{ role: money.kind === "MOBILE" ? ("MOBILE_CHARGE" as const) : ("BANK_CHARGE" as const), debit: charge, credit: ZERO }] : []),
      { accountId: money.id, debit: ZERO, credit: input.amount.plus(charge) },
    ],
  });
  const payment = await tx.supplierPayment.create({
    data: {
      id: paymentId,
      organizationId: input.organizationId,
      branchId: input.branchId,
      supplierId: input.supplierId,
      number,
      businessDate: occurredDate(input.businessDate),
      method: money.kind,
      accountId: money.id,
      amount: input.amount,
      charge,
      journalId,
    },
    select: { id: true, number: true },
  });
  if (input.purchaseId) {
    await tx.purchasePayment.create({ data: { organizationId: input.organizationId, purchaseId: input.purchaseId, method: money.kind, amount: input.amount } });
  }
  return { ...payment, journalId };
}

/** Locks the vendor (one payment, advance or application at a time, so two cannot settle the same bill twice). */
async function lockSupplier(tx: Tx, organizationId: string, supplierId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM suppliers WHERE id = ${supplierId} AND organizationId = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
  `;
  if (!locked[0]) {
    throw new StockRuleError("That record was not found.", 404);
  }
  return locked[0].id;
}

async function replay(tx: Tx, input: Actor, requestHash: string) {
  const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
  if (existing === "mismatch") {
    throw new StockRuleError("This idempotency key was already used for a different request.", 409);
  }
  return existing;
}

async function audit(input: Actor, entityType: string, entityId: string, action: string, after: Record<string, unknown>) {
  await writeAudit({
    organizationId: input.organizationId,
    branchId: input.branchId,
    userId: input.userId,
    action,
    module: "suppliers",
    entityType,
    entityId,
    after: after as Prisma.InputJsonObject,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

async function guarded<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export type SupplierPaymentInput = Actor & {
  supplierId: string;
  businessDate: string;
  amount: string;
  /** CASH, BANK or MOBILE; the account says which exact one. */
  method: "CASH" | "BANK" | "MOBILE";
  /** The cash, bank or mobile account the money leaves (the default cash drawer or bank when left out). */
  accountId?: string;
  /** What the bank or mobile service takes on top of the payment: an expense, not paid to the vendor. */
  charge?: string;
  /** The bills this payment is for; what they do not cover settles the oldest debt first. */
  allocations?: Array<{ billId: string; amount: string }>;
};

export function postSupplierPayment(input: SupplierPaymentInput) {
  const requestHash = hashPayload({
    supplierId: input.supplierId,
    businessDate: input.businessDate,
    amount: input.amount,
    method: input.method,
    accountId: input.accountId ?? null,
    charge: input.charge ?? null,
    allocations: input.allocations ?? null,
  });
  return guarded(async () => {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await replay(tx, input, requestHash);
      if (existing) {
        return { id: existing.entityId, number: null as string | null, replayed: true };
      }
      const supplierId = await lockSupplier(tx, input.organizationId, input.supplierId);
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new StockRuleError("Enter a payment amount greater than zero.");
      }
      const charge = amountOf(input.charge, "a charge");
      const balance = await partyBalance(tx, { organizationId: input.organizationId, partyType: "VENDOR", partyId: supplierId });
      if (amount.gt(balance)) {
        throw new StockRuleError(`The payment is more than the ${balance.toFixed(2)} owed to this vendor. Pay what is owed, and record the rest as an advance.`);
      }
      const payment = await settleSupplier(tx, { ...input, supplierId, amount, charge });
      await allocatePayment(tx, {
        organizationId: input.organizationId,
        kind: "VENDOR",
        partyId: supplierId,
        journalId: payment.journalId,
        amount,
        named: input.allocations?.map((row) => ({ documentId: row.billId, amount: row.amount })),
      });
      await saveIdempotency(tx, { organizationId: input.organizationId, userId: input.userId, key: input.idempotencyKey, requestHash, entityType: "supplier_payment", entityId: payment.id });
      return { id: payment.id, number: payment.number as string | null, replayed: false };
    });
    if (!data.replayed) {
      await audit(input, "supplier_payment", data.id, "payment", { number: data.number });
    }
    return { ok: true as const, ...data };
  });
}

export type SupplierAdvanceInput = Actor & {
  supplierId: string;
  businessDate: string;
  amount: string;
  method: "CASH" | "BANK" | "MOBILE";
  accountId?: string;
};

/** Money paid to a vendor ahead of a bill (#14): the shop holds a claim on the vendor, Dr Advance to Vendor / Cr the money account. */
export function postSupplierAdvance(input: SupplierAdvanceInput) {
  const requestHash = hashPayload({ kind: "advance", supplierId: input.supplierId, businessDate: input.businessDate, amount: input.amount, method: input.method, accountId: input.accountId ?? null });
  return guarded(async () => {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await replay(tx, input, requestHash);
      if (existing) {
        return { id: existing.entityId, number: null as string | null, replayed: true };
      }
      const supplierId = await lockSupplier(tx, input.organizationId, input.supplierId);
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new StockRuleError("Enter an advance amount greater than zero.");
      }
      const money = await moneyOf(tx, input.organizationId, input.method, input.accountId);
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "PAY", businessDate: input.businessDate });
      const advanceId = randomUUID();
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Vendor advance ${number}`,
        createdById: input.userId,
        doc: { type: "SUPPLIER_ADVANCE", id: advanceId },
        lines: [
          { role: "VENDOR_ADVANCE", debit: amount, credit: ZERO, party: { type: "VENDOR" as const, id: supplierId } },
          { accountId: money.id, debit: ZERO, credit: amount },
        ],
      });
      await tx.supplierAdvance.create({
        data: { id: advanceId, organizationId: input.organizationId, branchId: input.branchId, supplierId, number, businessDate: occurredDate(input.businessDate), accountId: money.id, amount, journalId },
      });
      await saveIdempotency(tx, { organizationId: input.organizationId, userId: input.userId, key: input.idempotencyKey, requestHash, entityType: "supplier_advance", entityId: advanceId });
      return { id: advanceId, number: number as string | null, replayed: false };
    });
    if (!data.replayed) {
      await audit(input, "supplier_advance", data.id, "advance", { number: data.number });
    }
    return { ok: true as const, ...data };
  });
}

export type ApplyAdvanceInput = Actor & {
  supplierId: string;
  businessDate: string;
  amount: string;
  /** The bills the advance is used for; what they do not cover settles the oldest debt first. */
  allocations?: Array<{ billId: string; amount: string }>;
};

/**
 * Uses money held with a vendor against what the shop owes them (#15): Dr Payable / Cr Advance to Vendor. It settles bills like a
 * payment does (and is listed with the payments), but no cash or bank account moves.
 */
export function applySupplierAdvance(input: ApplyAdvanceInput) {
  const requestHash = hashPayload({ kind: "apply", supplierId: input.supplierId, businessDate: input.businessDate, amount: input.amount, allocations: input.allocations ?? null });
  return guarded(async () => {
    const data = await idempotentTransaction(async (tx) => {
      const existing = await replay(tx, input, requestHash);
      if (existing) {
        return { id: existing.entityId, number: null as string | null, replayed: true };
      }
      const supplierId = await lockSupplier(tx, input.organizationId, input.supplierId);
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new StockRuleError("Enter an amount greater than zero.");
      }
      const held = await partyBalance(tx, { organizationId: input.organizationId, partyType: "VENDOR", partyId: supplierId, account: "ADVANCE" });
      if (amount.gt(held)) {
        throw new StockRuleError(`Only ${held.toFixed(2)} is held with this vendor as an advance.`);
      }
      const owed = await partyBalance(tx, { organizationId: input.organizationId, partyType: "VENDOR", partyId: supplierId });
      if (amount.gt(owed)) {
        throw new StockRuleError(`Only ${owed.toFixed(2)} is owed to this vendor.`);
      }
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "PAY", businessDate: input.businessDate });
      const paymentId = randomUUID();
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Advance used ${number}`,
        createdById: input.userId,
        doc: { type: "SUPPLIER_PAYMENT", id: paymentId },
        lines: [
          { role: "AP", debit: amount, credit: ZERO, party: { type: "VENDOR" as const, id: supplierId } },
          { role: "VENDOR_ADVANCE", debit: ZERO, credit: amount, party: { type: "VENDOR" as const, id: supplierId } },
        ],
      });
      await tx.supplierPayment.create({
        data: { id: paymentId, organizationId: input.organizationId, branchId: input.branchId, supplierId, number, businessDate: occurredDate(input.businessDate), method: "ADVANCE", amount, charge: ZERO, journalId },
      });
      await allocatePayment(tx, {
        organizationId: input.organizationId,
        kind: "VENDOR",
        partyId: supplierId,
        journalId,
        amount,
        named: input.allocations?.map((row) => ({ documentId: row.billId, amount: row.amount })),
      });
      await saveIdempotency(tx, { organizationId: input.organizationId, userId: input.userId, key: input.idempotencyKey, requestHash, entityType: "supplier_payment", entityId: paymentId });
      return { id: paymentId, number: number as string | null, replayed: false };
    });
    if (!data.replayed) {
      await audit(input, "supplier_payment", data.id, "advance-applied", { number: data.number });
    }
    return { ok: true as const, ...data };
  });
}
