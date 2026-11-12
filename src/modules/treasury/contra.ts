import { randomUUID } from "node:crypto";

import { RuleError } from "@/core/errors/rule-error";
import { hashPayload } from "@/core/idempotency";
import { zero } from "@/core/money";
import { runTx } from "@/core/tx/run";
import { occurredDate } from "@/lib/format/date";
import { postBalancedJournal } from "@/modules/accounting/post";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { amountOf, failure, type Actor } from "@/modules/purchasing/common";
import { chargeLines, checkCharge, checkDate, moneyAccountOf, remember, replay } from "@/modules/treasury/common";

// A contra transfer (P08 task 4, #31): the shop's own money moving between its cash, bank and mobile accounts. Dr the account it goes to / Cr the one it
// leaves; when the sending bank or mobile service takes a charge, that is a line too (6600 / 6610) and the sender loses the amount and the charge.
// It is the shop's money both before and after, so nothing is income or expense but the charge. A transfer into or out of a drawer carries the
// shift, so the drawer's count includes it.

export async function postContraTransfer(input: Actor & { businessDate: string; fromAccountId: string; toAccountId: string; amount: string; charge?: string; note?: string }) {
  const requestHash = hashPayload({ date: input.businessDate, from: input.fromAccountId, to: input.toAccountId, amount: input.amount, charge: input.charge ?? "", note: input.note ?? "" });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, number: null as string | null, replayed: true };
      }
      const date = checkDate(input.businessDate);
      const amount = amountOf(input.amount, "the amount");
      if (amount.lte(0)) {
        throw new RuleError("Enter an amount greater than zero.");
      }
      if (input.fromAccountId === input.toAccountId) {
        throw new RuleError("Choose two different accounts.");
      }
      const from = await moneyAccountOf(tx, input.organizationId, input.fromAccountId);
      const to = await moneyAccountOf(tx, input.organizationId, input.toAccountId);
      const charge = amountOf(input.charge, "the charge");
      checkCharge(from.kind, charge);
      const id = randomUUID();
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "CTR", businessDate: date });
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(date),
        description: `Transfer ${number}: ${from.name} to ${to.name}`,
        createdById: input.userId,
        doc: { type: "CONTRA", id },
        number,
        lines: [
          { accountId: to.id, debit: amount, credit: zero() },
          ...chargeLines(from.kind, charge),
          { accountId: from.id, debit: zero(), credit: amount.plus(charge) },
        ],
      });
      const shift = await tx.journalLine.findFirst({ where: { journalId, shiftId: { not: null } }, select: { shiftId: true } });
      await tx.contraTransfer.create({
        data: { id, organizationId: input.organizationId, branchId: input.branchId, number, businessDate: occurredDate(date), fromAccountId: from.id, toAccountId: to.id, amount, charge, shiftId: shift?.shiftId ?? null, note: input.note?.trim() || null, journalId, createdById: input.userId },
      });
      await remember(tx, { ...input, requestHash, entityType: "contra", entityId: id });
      return { id, number, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "accounting post", module: "accounting", entityType: "contra", entityId: data.id, after: { number: data.number }, ip: input.ip, userAgent: input.userAgent });
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
