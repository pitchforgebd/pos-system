import { Prisma } from "@prisma/client";

export class PostingError extends Error {
  status: 404 | 409 | 422;

  constructor(message: string, status: 404 | 409 | 422 = 422) {
    super(message);
    this.name = "PostingError";
    this.status = status;
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
        })),
      },
    },
    select: { id: true },
  });
  return journal.id;
}
