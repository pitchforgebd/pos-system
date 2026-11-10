import { Prisma } from "@prisma/client";

import { RuleError, type RuleStatus } from "@/core/errors/rule-error";
import { accountsFor } from "@/core/ledger/accounts";
import type { AccountRole } from "@/core/ledger/roles";
import { dateOnly } from "@/core/time/business-date";
import { assertPostable } from "@/core/time/period";

export class PostingError extends RuleError {
  constructor(message: string, status: RuleStatus = 422) {
    super(message, status);
    this.name = "PostingError";
  }
}

/**
 * One line of a journal. Name the account in exactly one way: by role (every account the posting rules own: cash, receivable,
 * sales ...), by id (a cash or bank account the user picked), or by code (an account the user typed in a manual journal or a
 * voucher). Code in this system never writes a number itself.
 */
export type JournalLineInput = (
  | { role: AccountRole; accountId?: never; accountCode?: never }
  | { accountId: string; role?: never; accountCode?: never }
  | { accountCode: string; role?: never; accountId?: never }
) & {
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
};

export async function postBalancedJournal(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    branchId: string;
    businessDate: Date;
    description: string;
    createdById: string;
    lines: JournalLineInput[];
    number?: string | null;
    reversalOfId?: string | null;
  },
) {
  let debit = new Prisma.Decimal(0);
  let credit = new Prisma.Decimal(0);
  for (const line of input.lines) {
    if (line.debit.isNeg() || line.credit.isNeg() || (line.debit.gt(0) && line.credit.gt(0))) {
      throw new PostingError("A journal line must be a debit or a credit.");
    }
    debit = debit.plus(line.debit);
    credit = credit.plus(line.credit);
  }
  if (!debit.eq(credit)) {
    throw new PostingError("The journal is not balanced.");
  }
  // The period rules apply to every posting: not in the future, not in a locked period (invariant I11).
  await assertPostable(tx, { organizationId: input.organizationId }, dateOnly(input.businessDate));
  const roles = [...new Set(input.lines.flatMap((line) => (line.role ? [line.role] : [])))];
  const ids = [...new Set(input.lines.flatMap((line) => (line.accountId ? [line.accountId] : [])))];
  const codes = [...new Set(input.lines.flatMap((line) => (line.accountCode ? [line.accountCode] : [])))];
  if (input.lines.some((line) => [line.role, line.accountId, line.accountCode].filter(Boolean).length !== 1)) {
    throw new PostingError("A journal line names its account by role, id or code, one of them.");
  }
  const byRole = roles.length > 0 ? await accountsFor(tx, input.organizationId, roles) : new Map<AccountRole, string>();
  const active = await tx.account.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      OR: [{ id: { in: [...ids, ...byRole.values()] } }, { code: { in: codes } }],
    },
    select: { id: true, code: true },
  });
  const activeIds = new Set(active.map((account) => account.id));
  const idByCode = new Map(active.map((account) => [account.code, account.id]));
  const resolve = (line: JournalLineInput) => {
    const id = line.role ? byRole.get(line.role) : line.accountId ? line.accountId : idByCode.get(line.accountCode as string);
    if (!id || !activeIds.has(id)) {
      throw new PostingError(line.role || line.accountId ? "That account is closed or does not exist." : "The chart of accounts is missing an account this entry requires.");
    }
    return id;
  };
  const journal = await tx.journal.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      businessDate: input.businessDate,
      status: "POSTED",
      description: input.description,
      postedAt: new Date(),
      createdById: input.createdById,
      number: input.number ?? null,
      reversalOfId: input.reversalOfId ?? null,
      lines: {
        create: input.lines.map((line) => ({
          organizationId: input.organizationId,
          accountId: resolve(line),
          debit: line.debit,
          credit: line.credit,
          // The date and branch of the journal are kept on every line, so reports need no join.
          businessDate: input.businessDate,
          branchId: input.branchId,
        })),
      },
    },
    select: { id: true },
  });
  return journal.id;
}
