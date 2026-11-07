import { Prisma } from "@prisma/client";
import { runTx } from "@/core/tx/run";
import { RuleError } from "@/core/errors/rule-error";
import { businessDate, dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { PostingError, postBalancedJournal } from "@/modules/accounting/post";
import { allocateNumber, documentYear } from "@/modules/documents/numbers";
import { hashPayload, readIdempotency, saveIdempotency } from "@/modules/inventory/idempotency";
import { decimalString, money, parseMoney, zero } from "@/core/money";
import { isIsoDate, occurredDate } from "@/lib/format/date";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
};

export type JournalLineInput = { accountCode: string; debit: string; credit: string };

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const code = error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return { ok: false, status: error.status, code, message: error.message };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

function parseLines(lines: JournalLineInput[]) {
  if (lines.length < 2) {
    throw new PostingError("A journal needs at least two lines.");
  }
  const parsed = lines.map((line) => {
    const debit = parseMoney(line.debit);
    const credit = parseMoney(line.credit);
    if (!debit || !credit || debit.isNeg() || credit.isNeg() || (debit.gt(0) && credit.gt(0)) || (debit.eq(0) && credit.eq(0))) {
      throw new PostingError("Each line must be a debit or a credit greater than zero.");
    }
    return { accountCode: line.accountCode, debit, credit };
  });
  const debit = money(parsed.reduce((sum, line) => sum.plus(line.debit), zero()));
  const credit = money(parsed.reduce((sum, line) => sum.plus(line.credit), zero()));
  if (!debit.eq(credit) || debit.eq(0)) {
    throw new PostingError("The journal is not balanced.");
  }
  return { lines: parsed, total: debit };
}

async function remember(
  tx: Prisma.TransactionClient,
  input: Actor & { requestHash: string; entityType: string; entityId: string },
) {
  await saveIdempotency(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    entityType: input.entityType,
    entityId: input.entityId,
  });
}

async function begin(tx: Prisma.TransactionClient, organizationId: string, key: string, requestHash: string) {
  const existing = await readIdempotency(tx, { organizationId, key, requestHash });
  if (existing === "mismatch") {
    throw new PostingError("This idempotency key was already used for a different request.", 409);
  }
  return existing;
}

export async function postJournal(input: Actor & { businessDate: string; description: string; lines: JournalLineInput[] }) {
  const requestHash = hashPayload({ businessDate: input.businessDate, description: input.description, lines: input.lines });
  try {
    const data = await runTx(async (tx) => {
      const existing = await begin(tx, input.organizationId, input.idempotencyKey, requestHash);
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const parsed = parseLines(input.lines);
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "VCH", year: documentYear(input.businessDate) });
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: input.description.trim() || `Journal ${number}`,
        createdById: input.userId,
        lines: parsed.lines,
        number,
      });
      await tx.voucher.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          number,
          voucherType: "JOURNAL",
          amount: parsed.total,
          businessDate: occurredDate(input.businessDate),
          status: "POSTED",
          journalId,
        },
      });
      await remember(tx, { ...input, requestHash, entityType: "journal", entityId: journalId });
      return { id: journalId, number, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "accounting post",
        module: "accounting",
        entityType: "journal",
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

export async function reverseJournal(input: Actor & { journalId: string; businessDate: string }) {
  const requestHash = hashPayload({ journalId: input.journalId, businessDate: input.businessDate });
  try {
    const data = await runTx(async (tx) => {
      const existing = await begin(tx, input.organizationId, input.idempotencyKey, requestHash);
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const journal = await tx.journal.findFirst({
        where: { id: input.journalId, organizationId: input.organizationId, branchId: input.branchId, status: "POSTED" },
        include: {
          lines: { include: { account: { select: { code: true } } } },
          reversals: { select: { id: true } },
          sale: { select: { id: true } },
          purchase: { select: { id: true } },
          saleReturn: { select: { id: true } },
          purchaseReturn: { select: { id: true } },
          customerPayment: { select: { id: true } },
          supplierPayment: { select: { id: true } },
          customerAdvance: { select: { id: true } },
          voucher: { select: { voucherType: true } },
        },
      });
      if (!journal) {
        throw new PostingError("That record was not found.", 404);
      }
      if (journal.reversals.length > 0) {
        throw new PostingError("That journal already has a reversal.");
      }
      if (journal.sale || journal.purchase || journal.saleReturn || journal.purchaseReturn || journal.customerPayment || journal.supplierPayment || journal.customerAdvance) {
        throw new PostingError("Correct the source document. This journal is not reversed on its own.");
      }
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "VCH", year: documentYear(input.businessDate) });
      const lines = journal.lines
        .filter((line) => new Prisma.Decimal(line.debit).gt(0) || new Prisma.Decimal(line.credit).gt(0))
        .map((line) => ({ accountCode: line.account.code, debit: new Prisma.Decimal(line.credit), credit: new Prisma.Decimal(line.debit) }));
      const total = money(lines.reduce((sum, line) => sum.plus(line.debit), zero()));
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Reversal of ${journal.number ?? journal.description ?? "journal"}`,
        createdById: input.userId,
        lines,
        number,
        reversalOfId: journal.id,
      });
      await tx.voucher.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          number,
          voucherType: journal.voucher?.voucherType ?? "JOURNAL",
          amount: total,
          businessDate: occurredDate(input.businessDate),
          status: "POSTED",
          journalId,
        },
      });
      await remember(tx, { ...input, requestHash, entityType: "journal_reversal", entityId: journalId });
      return { id: journalId, number, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "accounting reverse",
        module: "accounting",
        entityType: "journal",
        entityId: data.id,
        after: { number: data.number, reversalOf: input.journalId },
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

export async function postExpense(
  input: Actor & { businessDate: string; accountCode: string; amount: string; method: "CASH" | "BANK"; note?: string },
) {
  const requestHash = hashPayload({
    businessDate: input.businessDate,
    accountCode: input.accountCode,
    amount: input.amount,
    method: input.method,
    note: input.note ?? null,
  });
  try {
    const data = await runTx(async (tx) => {
      const existing = await begin(tx, input.organizationId, input.idempotencyKey, requestHash);
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new PostingError("Enter an amount greater than zero.");
      }
      const account = await tx.account.findFirst({
        where: { organizationId: input.organizationId, code: input.accountCode, status: "ACTIVE" },
        select: { id: true, code: true, group: { select: { code: true } } },
      });
      if (!account || account.group.code !== "6000") {
        throw new PostingError("Choose an active expense account.");
      }
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "EXP", year: documentYear(input.businessDate) });
      const cashCode = input.method === "BANK" ? "1200" : "1100";
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Expense ${number}`,
        createdById: input.userId,
        lines: [
          { accountCode: account.code, debit: amount, credit: zero() },
          { accountCode: cashCode, debit: zero(), credit: amount },
        ],
        number,
      });
      const expense = await tx.expense.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          accountId: account.id,
          number,
          amount,
          businessDate: occurredDate(input.businessDate),
          journalId,
          note: input.note?.trim() || null,
        },
        select: { id: true, number: true },
      });
      await remember(tx, { ...input, requestHash, entityType: "expense", entityId: expense.id });
      return { id: expense.id, number: expense.number, journalId, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "accounting post",
        module: "accounting",
        entityType: "expense",
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

export async function postContra(input: Actor & { businessDate: string; direction: "CASH_TO_BANK" | "BANK_TO_CASH"; amount: string }) {
  const requestHash = hashPayload({ businessDate: input.businessDate, direction: input.direction, amount: input.amount });
  try {
    const data = await runTx(async (tx) => {
      const existing = await begin(tx, input.organizationId, input.idempotencyKey, requestHash);
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new PostingError("Enter an amount greater than zero.");
      }
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "VCH", year: documentYear(input.businessDate) });
      const debitCode = input.direction === "CASH_TO_BANK" ? "1200" : "1100";
      const creditCode = input.direction === "CASH_TO_BANK" ? "1100" : "1200";
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Contra ${number}`,
        createdById: input.userId,
        lines: [
          { accountCode: debitCode, debit: amount, credit: zero() },
          { accountCode: creditCode, debit: zero(), credit: amount },
        ],
        number,
      });
      await tx.voucher.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          number,
          voucherType: "CONTRA",
          amount,
          businessDate: occurredDate(input.businessDate),
          status: "POSTED",
          journalId,
        },
      });
      await remember(tx, { ...input, requestHash, entityType: "contra", entityId: journalId });
      return { id: journalId, number, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "accounting post",
        module: "accounting",
        entityType: "contra",
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

export async function createAccount(input: { organizationId: string; code: string; name: string; groupCode: string }) {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!/^[A-Z0-9]{2,16}$/.test(code) || !name) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter an account code and name." };
  }
  const group = await prisma.accountGroup.findFirst({
    where: { organizationId: input.organizationId, code: input.groupCode },
    select: { id: true },
  });
  if (!group) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  try {
    const account = await prisma.account.create({
      data: { organizationId: input.organizationId, groupId: group.id, code, name },
      select: { id: true, code: true, name: true },
    });
    return { ok: true as const, account };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: "That account code is already used." };
    }
    throw error;
  }
}

export async function listAccounts(organizationId: string) {
  const rows = await prisma.account.findMany({
    where: { organizationId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, status: true, group: { select: { code: true, name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    groupCode: row.group.code,
    groupName: row.group.name,
  }));
}

export async function listGroups(organizationId: string) {
  const rows = await prisma.accountGroup.findMany({
    where: { organizationId },
    orderBy: { code: "asc" },
    select: { code: true, name: true },
  });
  return rows;
}

export async function listJournals(organizationId: string, branchId: string) {
  const rows = await prisma.journal.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: { id: true, number: true, description: true, status: true, businessDate: true, lines: { select: { debit: true, credit: true } } },
  });
  return rows.map((row) => {
    const debit = row.lines.reduce((sum, line) => sum.plus(line.debit), zero());
    const credit = row.lines.reduce((sum, line) => sum.plus(line.credit), zero());
    return {
      id: row.id,
      number: row.number,
      description: row.description,
      status: row.status,
      businessDate: dateOnly(row.businessDate),
      debit: decimalString(debit, 2),
      credit: decimalString(credit, 2),
      balanced: debit.eq(credit),
    };
  });
}

export async function getJournal(organizationId: string, branchId: string, id: string) {
  const row = await prisma.journal.findFirst({
    where: { id, organizationId, branchId },
    include: {
      lines: { include: { account: { select: { code: true, name: true } } } },
      reversals: { select: { id: true, number: true } },
      sale: { select: { id: true } },
      purchase: { select: { id: true } },
      saleReturn: { select: { id: true } },
      purchaseReturn: { select: { id: true } },
      customerPayment: { select: { id: true } },
      supplierPayment: { select: { id: true } },
      customerAdvance: { select: { id: true } },
    },
  });
  if (!row) {
    return null;
  }
  const debit = row.lines.reduce((sum, line) => sum.plus(line.debit), zero());
  const credit = row.lines.reduce((sum, line) => sum.plus(line.credit), zero());
  const source = Boolean(row.sale || row.purchase || row.saleReturn || row.purchaseReturn || row.customerPayment || row.supplierPayment || row.customerAdvance);
  return {
    id: row.id,
    number: row.number,
    description: row.description,
    status: row.status,
    businessDate: dateOnly(row.businessDate),
    balanced: debit.eq(credit),
    reversible: row.status === "POSTED" && row.reversals.length === 0 && !source,
    reversals: row.reversals.map((reversal) => ({ id: reversal.id, number: reversal.number })),
    lines: row.lines.map((line) => ({
      id: line.id,
      accountCode: line.account.code,
      accountName: line.account.name,
      debit: decimalString(line.debit, 2),
      credit: decimalString(line.credit, 2),
    })),
  };
}

export async function listExpenses(organizationId: string, branchId: string) {
  const rows = await prisma.expense.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: { id: true, number: true, amount: true, businessDate: true, note: true, account: { select: { code: true, name: true } }, journalId: true },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    amount: decimalString(row.amount, 2),
    businessDate: dateOnly(row.businessDate),
    accountCode: row.account.code,
    accountName: row.account.name,
    note: row.note,
    journalId: row.journalId,
  }));
}

export async function listVouchers(organizationId: string, branchId: string) {
  const rows = await prisma.voucher.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: { id: true, number: true, voucherType: true, amount: true, businessDate: true, status: true, journalId: true },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    voucherType: row.voucherType,
    amount: decimalString(row.amount, 2),
    businessDate: dateOnly(row.businessDate),
    status: row.status,
    journalId: row.journalId,
  }));
}

export async function accountStatement(input: { organizationId: string; branchId: string; accountCode: string; from: string; to: string }) {
  const account = await prisma.account.findFirst({
    where: { organizationId: input.organizationId, code: input.accountCode },
    select: { id: true, code: true, name: true },
  });
  if (!account) {
    return null;
  }
  if (!isIsoDate(input.from) || !isIsoDate(input.to)) {
    return null;
  }
  const from = occurredDate(input.from);
  const to = occurredDate(input.to);
  const prior = await prisma.journalLine.aggregate({
    where: {
      organizationId: input.organizationId,
      accountId: account.id,
      journal: { status: "POSTED", branchId: input.branchId, businessDate: { lt: from } },
    },
    _sum: { debit: true, credit: true },
  });
  let running = new Prisma.Decimal(prior._sum.debit ?? 0).minus(prior._sum.credit ?? 0);
  const opening = running;
  const rows = await prisma.journalLine.findMany({
    where: {
      organizationId: input.organizationId,
      accountId: account.id,
      journal: { status: "POSTED", branchId: input.branchId, businessDate: { gte: from, lte: to } },
    },
    orderBy: [{ journal: { businessDate: "asc" } }, { createdAt: "asc" }],
    select: { id: true, debit: true, credit: true, journal: { select: { number: true, description: true, businessDate: true } } },
  });
  const lines = rows.map((row) => {
    running = running.plus(row.debit).minus(row.credit);
    return {
      id: row.id,
      businessDate: dateOnly(row.journal.businessDate),
      reference: row.journal.number ?? row.journal.description ?? "Journal",
      debit: decimalString(row.debit, 2),
      credit: decimalString(row.credit, 2),
      balance: decimalString(running, 2),
    };
  });
  return { account, opening: decimalString(opening, 2), lines };
}

export async function listCashBankLines(organizationId: string, branchId: string, from?: string, to?: string) {
  const rows = await prisma.journalLine.findMany({
    where: {
      organizationId,
      account: { OR: [{ code: "1100" }, { code: { startsWith: "12" } }] },
      journal: {
        status: "POSTED",
        branchId,
        businessDate: from && to && isIsoDate(from) && isIsoDate(to) ? { gte: occurredDate(from), lte: occurredDate(to) } : undefined,
      },
    },
    orderBy: { journal: { businessDate: "desc" } },
    take: 100,
    select: {
      id: true,
      debit: true,
      credit: true,
      account: { select: { code: true, name: true } },
      journal: {
        select: {
          number: true,
          description: true,
          businessDate: true,
          createdBy: { select: { email: true } },
          sale: { select: { id: true } },
          purchase: { select: { id: true } },
          saleReturn: { select: { id: true } },
          purchaseReturn: { select: { id: true } },
          customerPayment: { select: { id: true } },
          customerAdvance: { select: { id: true } },
          supplierPayment: { select: { id: true } },
          expense: { select: { id: true } },
          income: { select: { id: true } },
          capitalTransaction: { select: { id: true } },
          voucher: { select: { voucherType: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    businessDate: dateOnly(row.journal.businessDate),
    reference: row.journal.number ?? row.journal.description ?? "Journal",
    description: row.journal.description,
    accountCode: row.account.code,
    accountName: row.account.name,
    source: cashBankSource(row.journal),
    debit: decimalString(row.debit, 2),
    credit: decimalString(row.credit, 2),
    direction: new Prisma.Decimal(row.debit).gt(0) ? "DR" : "CR",
    user: row.journal.createdBy?.email ?? "",
  }));
}

function cashBankSource(journal: {
  sale: { id: string } | null;
  purchase: { id: string } | null;
  saleReturn: { id: string } | null;
  purchaseReturn: { id: string } | null;
  customerPayment: { id: string } | null;
  customerAdvance: { id: string } | null;
  supplierPayment: { id: string } | null;
  expense: { id: string } | null;
  income?: { id: string } | null;
  capitalTransaction?: { id: string } | null;
  voucher: { voucherType: string } | null;
}) {
  if (journal.sale) return "Sale";
  if (journal.purchase) return "Purchase";
  if (journal.saleReturn) return "Sale return";
  if (journal.purchaseReturn) return "Purchase return";
  if (journal.customerPayment) return "Due collection";
  if (journal.customerAdvance) return "Advance";
  if (journal.supplierPayment) return "Supplier payment";
  if (journal.expense) return "Expense";
  if (journal.income) return "Income";
  if (journal.capitalTransaction) return "Capital";
  if (journal.voucher?.voucherType === "CONTRA") return "Contra";
  if (journal.voucher?.voucherType === "PAYMENT") return "Payment";
  if (journal.voucher?.voucherType === "RECEIPT") return "Receipt";
  if (journal.voucher) return "Journal";
  return "Journal";
}

export async function cashFlow(organizationId: string, branchId: string, from?: string, to?: string) {
  const sums = await prisma.journalLine.aggregate({
    where: {
      organizationId,
      account: { OR: [{ code: "1100" }, { code: { startsWith: "12" } }] },
      journal: {
        status: "POSTED",
        branchId,
        businessDate: from && to && isIsoDate(from) && isIsoDate(to) ? { gte: occurredDate(from), lte: occurredDate(to) } : undefined,
      },
    },
    _sum: { debit: true, credit: true },
  });
  const inflow = new Prisma.Decimal(sums._sum.debit ?? 0);
  const outflow = new Prisma.Decimal(sums._sum.credit ?? 0);
  return {
    inflow: decimalString(inflow, 2),
    outflow: decimalString(outflow, 2),
    net: decimalString(inflow.minus(outflow), 2),
  };
}

export async function cashBankBalances(organizationId: string, branchId: string) {
  const accounts = await prisma.account.findMany({
    where: { organizationId, OR: [{ code: "1100" }, { code: { startsWith: "12" } }] },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  if (accounts.length === 0) {
    return [];
  }
  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: { organizationId, accountId: { in: accounts.map((account) => account.id) }, journal: { status: "POSTED", branchId } },
    _sum: { debit: true, credit: true },
  });
  const byId = new Map(sums.map((row) => [row.accountId, new Prisma.Decimal(row._sum.debit ?? 0).minus(row._sum.credit ?? 0)]));
  return accounts.map((account) => ({
    code: account.code,
    name: account.name,
    balance: decimalString(byId.get(account.id) ?? new Prisma.Decimal(0), 2),
  }));
}

const blockedVoucherCodes = new Set(["1100", "1300", "1400", "2100", "4100", "5100"]);

async function resolveMoneyAccount(
  tx: Prisma.TransactionClient,
  organizationId: string,
  method: "CASH" | "BANK",
  bankCode?: string,
) {
  const code = method === "CASH" ? "1100" : bankCode?.trim() || "1200";
  if (method === "BANK" && !/^12\d{2}$/.test(code)) {
    throw new PostingError("Choose a bank account.");
  }
  const account = await tx.account.findFirst({
    where: { organizationId, code, status: "ACTIVE" },
    select: { id: true, code: true },
  });
  if (!account) {
    throw new PostingError("That cash or bank account is not active.");
  }
  return account;
}

async function nextAccountCode(tx: Prisma.TransactionClient, organizationId: string, start: number, end: number) {
  const rows = await tx.account.findMany({
    where: { organizationId },
    select: { code: true },
  });
  const used = new Set(rows.map((row) => row.code));
  for (let code = start; code <= end; code += 1) {
    const text = String(code);
    if (!used.has(text)) {
      return text;
    }
  }
  throw new PostingError("No free account code is left in that range.");
}

async function finishPost(
  input: Actor,
  data: { id: string; number: string | null; replayed: boolean },
  entityType: string,
) {
  if (!data.replayed) {
    await writeAudit({
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.userId,
      action: "accounting post",
      module: "accounting",
      entityType,
      entityId: data.id,
      after: { number: data.number },
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }
  return { ok: true as const, ...data };
}

export async function postIncome(
  input: Actor & { businessDate: string; accountCode: string; amount: string; method: "CASH" | "BANK"; bankCode?: string; category?: string; note?: string },
) {
  const requestHash = hashPayload({
    businessDate: input.businessDate,
    accountCode: input.accountCode,
    amount: input.amount,
    method: input.method,
    bankCode: input.bankCode ?? null,
    category: input.category ?? null,
    note: input.note ?? null,
  });
  try {
    const data = await runTx(async (tx) => {
      const existing = await begin(tx, input.organizationId, input.idempotencyKey, requestHash);
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new PostingError("Enter an amount greater than zero.");
      }
      const account = await tx.account.findFirst({
        where: { organizationId: input.organizationId, code: input.accountCode, status: "ACTIVE" },
        select: { id: true, code: true, group: { select: { code: true } } },
      });
      if (!account || account.group.code !== "4000" || account.code === "4100") {
        throw new PostingError("Choose an income account other than sales.");
      }
      const moneyAccount = await resolveMoneyAccount(tx, input.organizationId, input.method, input.bankCode);
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "VCH", year: documentYear(input.businessDate) });
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `Income ${number}`,
        createdById: input.userId,
        lines: [
          { accountCode: moneyAccount.code, debit: amount, credit: zero() },
          { accountCode: account.code, debit: zero(), credit: amount },
        ],
        number,
      });
      const income = await tx.income.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          accountId: account.id,
          category: input.category?.trim() || account.code,
          amount,
          businessDate: occurredDate(input.businessDate),
          journalId,
          note: input.note?.trim() || null,
        },
        select: { id: true },
      });
      await remember(tx, { ...input, requestHash, entityType: "income", entityId: income.id });
      return { id: income.id, number, replayed: false };
    });
    return finishPost(input, data, "income");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function postCapital(
  input: Actor & { businessDate: string; capitalType: "ADDED" | "WITHDRAW"; ownerName: string; amount: string; method: "CASH" | "BANK"; bankCode?: string },
) {
  const requestHash = hashPayload({
    businessDate: input.businessDate,
    capitalType: input.capitalType,
    ownerName: input.ownerName,
    amount: input.amount,
    method: input.method,
    bankCode: input.bankCode ?? null,
  });
  try {
    const data = await runTx(async (tx) => {
      const existing = await begin(tx, input.organizationId, input.idempotencyKey, requestHash);
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const amount = parseMoney(input.amount);
      const ownerName = input.ownerName.trim();
      if (!amount || amount.lte(0) || !ownerName) {
        throw new PostingError("Enter an owner name and an amount greater than zero.");
      }
      const moneyAccount = await resolveMoneyAccount(tx, input.organizationId, input.method, input.bankCode);
      const equityCode = input.capitalType === "ADDED" ? "3100" : "3200";
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "VCH", year: documentYear(input.businessDate) });
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: input.capitalType === "ADDED" ? `Capital added ${number}` : `Capital withdrawn ${number}`,
        createdById: input.userId,
        lines:
          input.capitalType === "ADDED"
            ? [
                { accountCode: moneyAccount.code, debit: amount, credit: zero() },
                { accountCode: equityCode, debit: zero(), credit: amount },
              ]
            : [
                { accountCode: equityCode, debit: amount, credit: zero() },
                { accountCode: moneyAccount.code, debit: zero(), credit: amount },
              ],
        number,
      });
      const row = await tx.capitalTransaction.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          capitalType: input.capitalType,
          ownerName,
          amount,
          businessDate: occurredDate(input.businessDate),
          journalId,
        },
        select: { id: true },
      });
      await remember(tx, { ...input, requestHash, entityType: "capital", entityId: row.id });
      return { id: row.id, number, replayed: false };
    });
    return finishPost(input, data, "capital");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function postLoan(
  input: Actor & { businessDate: string; direction: "RECEIVED" | "PAID"; lender: string; amount: string; method: "CASH" | "BANK"; bankCode?: string },
) {
  const requestHash = hashPayload({
    businessDate: input.businessDate,
    direction: input.direction,
    lender: input.lender,
    amount: input.amount,
    method: input.method,
    bankCode: input.bankCode ?? null,
  });
  try {
    const data = await runTx(async (tx) => {
      const existing = await begin(tx, input.organizationId, input.idempotencyKey, requestHash);
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const amount = parseMoney(input.amount);
      const lender = input.lender.trim();
      if (!amount || amount.lte(0) || !lender) {
        throw new PostingError("Enter a lender and an amount greater than zero.");
      }
      const moneyAccount = await resolveMoneyAccount(tx, input.organizationId, input.method, input.bankCode);
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "VCH", year: documentYear(input.businessDate) });
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: input.direction === "RECEIVED" ? `Loan received ${lender} ${number}` : `Loan paid ${lender} ${number}`,
        createdById: input.userId,
        lines:
          input.direction === "RECEIVED"
            ? [
                { accountCode: moneyAccount.code, debit: amount, credit: zero() },
                { accountCode: "2200", debit: zero(), credit: amount },
              ]
            : [
                { accountCode: "2200", debit: amount, credit: zero() },
                { accountCode: moneyAccount.code, debit: zero(), credit: amount },
              ],
        number,
      });
      const known = await tx.loan.findFirst({
        where: { organizationId: input.organizationId, lender },
        select: { id: true },
      });
      const loan = known
        ? known
        : await tx.loan.create({
            data: { organizationId: input.organizationId, lender },
            select: { id: true },
          });
      await remember(tx, { ...input, requestHash, entityType: "loan", entityId: journalId });
      return { id: loan.id, number, replayed: false };
    });
    return finishPost(input, data, "loan");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function postCashVoucher(
  input: Actor & { businessDate: string; voucherType: "PAYMENT" | "RECEIPT"; accountCode: string; amount: string; method: "CASH" | "BANK"; bankCode?: string },
) {
  const requestHash = hashPayload({
    businessDate: input.businessDate,
    voucherType: input.voucherType,
    accountCode: input.accountCode,
    amount: input.amount,
    method: input.method,
    bankCode: input.bankCode ?? null,
  });
  try {
    const data = await runTx(async (tx) => {
      const existing = await begin(tx, input.organizationId, input.idempotencyKey, requestHash);
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const amount = parseMoney(input.amount);
      if (!amount || amount.lte(0)) {
        throw new PostingError("Enter an amount greater than zero.");
      }
      const account = await tx.account.findFirst({
        where: { organizationId: input.organizationId, code: input.accountCode, status: "ACTIVE" },
        select: { code: true, group: { select: { code: true } } },
      });
      if (!account || blockedVoucherCodes.has(account.code) || /^12\d{2}$/.test(account.code) || !["2000", "3000", "4000", "6000"].includes(account.group.code)) {
        throw new PostingError("Choose an expense, income, loan, or equity account. Sales, stock, and party balances use their own screens.");
      }
      const moneyAccount = await resolveMoneyAccount(tx, input.organizationId, input.method, input.bankCode);
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "VCH", year: documentYear(input.businessDate) });
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(input.businessDate),
        description: `${input.voucherType === "PAYMENT" ? "Payment" : "Receipt"} ${number}`,
        createdById: input.userId,
        lines:
          input.voucherType === "PAYMENT"
            ? [
                { accountCode: account.code, debit: amount, credit: zero() },
                { accountCode: moneyAccount.code, debit: zero(), credit: amount },
              ]
            : [
                { accountCode: moneyAccount.code, debit: amount, credit: zero() },
                { accountCode: account.code, debit: zero(), credit: amount },
              ],
        number,
      });
      await tx.voucher.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          number,
          voucherType: input.voucherType,
          amount,
          businessDate: occurredDate(input.businessDate),
          status: "POSTED",
          journalId,
        },
      });
      await remember(tx, { ...input, requestHash, entityType: "voucher", entityId: journalId });
      return { id: journalId, number, replayed: false };
    });
    return finishPost(input, data, "voucher");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function createBankAccount(
  input: Actor & { name: string; openingAmount?: string },
) {
  const requestHash = hashPayload({ name: input.name, openingAmount: input.openingAmount ?? "0.00" });
  try {
    const data = await runTx(async (tx) => {
      const existing = await begin(tx, input.organizationId, input.idempotencyKey, requestHash);
      if (existing) {
        return { id: existing.entityId, replayed: true, number: null as string | null };
      }
      const name = input.name.trim();
      if (!name) {
        throw new PostingError("Enter a bank name.");
      }
      const duplicate = await tx.bankAccount.findFirst({
        where: { organizationId: input.organizationId, name },
        select: { id: true },
      });
      if (duplicate) {
        throw new PostingError("That bank name already exists.", 409);
      }
      const group = await tx.accountGroup.findFirst({
        where: { organizationId: input.organizationId, code: "1000" },
        select: { id: true },
      });
      if (!group) {
        throw new PostingError("The asset group is missing.");
      }
      const opening = parseMoney(input.openingAmount && input.openingAmount.trim() !== "" ? input.openingAmount : "0.00");
      if (!opening || opening.isNeg()) {
        throw new PostingError("Enter an opening amount of 0.00 or more.");
      }
      const code = await nextAccountCode(tx, input.organizationId, 1201, 1299);
      const account = await tx.account.create({
        data: { organizationId: input.organizationId, groupId: group.id, code, name },
        select: { id: true, code: true },
      });
      const bank = await tx.bankAccount.create({
        data: { organizationId: input.organizationId, branchId: input.branchId, accountId: account.id, name },
        select: { id: true },
      });
      let number: string | null = null;
      if (opening.gt(0)) {
        number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "VCH", year: documentYear(businessDate()) });
        await postBalancedJournal(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: occurredDate(businessDate()),
          description: `Bank opening ${name} ${number}`,
          createdById: input.userId,
          lines: [
            { accountCode: account.code, debit: opening, credit: zero() },
            { accountCode: "3100", debit: zero(), credit: opening },
          ],
          number,
        });
      }
      await remember(tx, { ...input, requestHash, entityType: "bank", entityId: bank.id });
      return { id: bank.id, number: account.code, replayed: false };
    });
    return finishPost(input, data, "bank");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}
