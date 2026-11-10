import { Prisma } from "@prisma/client";

import { RuleError, type RuleStatus } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";
import { assertPostable } from "@/core/time/period";

export class PostingError extends RuleError {
  constructor(message: string, status: RuleStatus = 422) {
    super(message, status);
    this.name = "PostingError";
  }
}

type JournalLineInput = {
  accountCode: string;
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
  const codes = [...new Set(input.lines.map((line) => line.accountCode))];
  const accounts = await tx.account.findMany({
    where: { organizationId: input.organizationId, code: { in: codes }, status: "ACTIVE" },
    select: { id: true, code: true },
  });
  const accountId = new Map(accounts.map((account) => [account.code, account.id]));
  if (codes.some((code) => !accountId.has(code))) {
    throw new PostingError("The chart of accounts is missing an account this entry requires.");
  }
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
          accountId: accountId.get(line.accountCode) ?? "",
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
