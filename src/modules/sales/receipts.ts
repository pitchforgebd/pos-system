import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { RuleError } from "@/core/errors/rule-error";
import { moneyAccountFor } from "@/core/ledger/accounts";
import { allocatePayment } from "@/core/payments";
import { postBalancedJournal } from "@/modules/accounting/post";
import { allocateNumber } from "@/modules/documents/numbers";
import { occurredDate } from "@/lib/format/date";

// A receipt (P06 task 6, #18): money the customer gave, whether at the till with an invoice or later against old invoices. Every sale goes
// through the customer's receivable (even a cash sale: the customer is Walk-in), so the receipt is what turns the invoice into PAID.
// Dr the money account (what came in, less the charge) [+ Dr the bank or mobile charge, D7: the shop bears it] / Cr Receivable.
// Paid from the customer's own advance (the wallet, #20) it is Dr Customer Advance / Cr Receivable and no money moves.

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

export type TenderMethod = "CASH" | "BANK" | "MOBILE" | "CARD" | "WALLET";

export type Tender = {
  method: TenderMethod;
  /** The cash, bank or mobile account the money comes into (the default cash drawer or bank when left out). */
  accountId?: string;
  amount: Prisma.Decimal;
  /** What the bank or mobile service keeps out of it. Not for cash or the wallet. */
  charge?: Prisma.Decimal;
};

/** The Walk-in customer of the organization: the system customer a sale with no named customer is made to. */
export async function ensureWalkIn(tx: Tx, organizationId: string) {
  const found = await tx.customer.findFirst({ where: { organizationId, isSystem: true }, select: { id: true } });
  if (found) {
    return found.id;
  }
  try {
    return (await tx.customer.create({ data: { organizationId, name: "Walk-in", isSystem: true }, select: { id: true } })).id;
  } catch (error) {
    // two sales made the first Walk-in at once: the other one's is the one
    const again = await tx.customer.findFirst({ where: { organizationId, isSystem: true }, select: { id: true } });
    if (again) {
      return again.id;
    }
    throw error;
  }
}

/**
 * Takes one receipt: its document, its journal, and settles invoices with it. `named` are the invoices it is for; what they do not cover
 * settles the oldest debt first. The caller has locked the customer.
 */
export async function takeReceipt(
  tx: Tx,
  input: {
    organizationId: string;
    branchId: string;
    userId: string;
    customerId: string;
    businessDate: string;
    tender: Tender;
    shiftId?: string | null;
    named?: Array<{ documentId: string; amount: string }>;
  },
) {
  const { tender } = input;
  const charge = tender.charge ?? ZERO;
  if (tender.amount.lte(0)) {
    throw new RuleError("Enter an amount greater than zero.");
  }
  if (charge.isNeg()) {
    throw new RuleError("A charge cannot be negative.");
  }
  const wallet = tender.method === "WALLET";
  let accountId: string | null = null;
  let kind = "CASH" as "CASH" | "BANK" | "MOBILE";
  if (!wallet) {
    if (tender.method === "MOBILE" && !tender.accountId) {
      throw new RuleError("Choose the mobile banking account.");
    }
    accountId = await moneyAccountFor(tx, input.organizationId, { method: tender.method === "CASH" ? "CASH" : "BANK", accountId: tender.accountId });
    kind = (await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { kind: true } })).kind as "CASH" | "BANK" | "MOBILE";
  }
  if (charge.gt(0) && (wallet || kind === "CASH")) {
    throw new RuleError("A cash or wallet payment has no bank or mobile charge.");
  }
  if (charge.gt(tender.amount)) {
    throw new RuleError("The charge is more than the payment.");
  }
  const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "RCV", businessDate: input.businessDate });
  const id = randomUUID();
  const party = { type: "CUSTOMER" as const, id: input.customerId };
  const journalId = await postBalancedJournal(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    businessDate: occurredDate(input.businessDate),
    description: `Receipt ${number}`,
    createdById: input.userId,
    doc: { type: "CUSTOMER_PAYMENT", id },
    lines: wallet
      ? [
          { role: "CUSTOMER_ADVANCE", debit: tender.amount, credit: ZERO, party },
          { role: "AR", debit: ZERO, credit: tender.amount, party },
        ]
      : [
          { accountId: accountId as string, debit: tender.amount.minus(charge), credit: ZERO, ...(input.shiftId && kind === "CASH" ? { shiftId: input.shiftId } : {}) },
          ...(charge.gt(0) ? [{ role: kind === "MOBILE" ? ("MOBILE_CHARGE" as const) : ("BANK_CHARGE" as const), debit: charge, credit: ZERO }] : []),
          { role: "AR", debit: ZERO, credit: tender.amount, party },
        ],
  });
  const payment = await tx.customerPayment.create({
    data: {
      id,
      organizationId: input.organizationId,
      branchId: input.branchId,
      customerId: input.customerId,
      number,
      businessDate: occurredDate(input.businessDate),
      method: wallet ? "WALLET" : kind,
      accountId,
      amount: tender.amount,
      charge,
      shiftId: input.shiftId ?? null,
      journalId,
    },
    select: { id: true, number: true },
  });
  const rows = await allocatePayment(tx, { organizationId: input.organizationId, kind: "CUSTOMER", partyId: input.customerId, journalId, amount: tender.amount, named: input.named });
  return { id: payment.id, number: payment.number as string, journalId, allocated: rows };
}
