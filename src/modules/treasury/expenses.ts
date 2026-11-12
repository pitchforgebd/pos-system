import { randomUUID } from "node:crypto";

import { Prisma, type ExpenseStatus, type ExpenseType } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { hashPayload } from "@/core/idempotency";
import { accountFor } from "@/core/ledger/accounts";
import type { AccountRole } from "@/core/ledger/roles";
import { GROUP } from "@/core/ledger/groups";
import { decimalString, zero } from "@/core/money";
import { dateOnly, businessDate as today } from "@/core/time/business-date";
import { runTx } from "@/core/tx/run";
import { prisma } from "@/lib/db/client";
import { occurredDate } from "@/lib/format/date";
import { postBalancedJournal } from "@/modules/accounting/post";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { amountOf, failure, type Actor } from "@/modules/purchasing/common";
import { chargeLines, checkCharge, checkDate, checkMonth, dateInMonth, lastDayOfMonth, monthOf, moneyAccountOf, remember, replay, type MoneyAccount } from "@/modules/treasury/common";

// Expenses (P08 task 3, feature 10). A fixed cost (rent, salary) has a category and a recurring entry: at the start of the month a draft is made for
// it, and "pay" posts it (Dr the expense / Cr the cash, bank or mobile account the money left). What nobody paid by month end the owner books as owed
// in one click (Dr the expense / Cr 2400 Accrued Expenses, #30); paying it later clears the accrual (Dr 2400 / Cr money). Every expense carries the
// month it belongs to (periodMonth), so October's rent paid in November is still October's. A bank or mobile service's charge is its own line.

type Who = { organizationId: string; branchId: string; userId: string; ip: string; userAgent: string | null };

// Each usual category and the account of the chart it posts to: by role where the chart has one, otherwise by the account's name (never by number, B8).
const DEFAULT_CATEGORIES: ReadonlyArray<{ name: string; type: ExpenseType; role?: AccountRole; accountName?: string }> = [
  { name: "Rent", type: "MONTHLY_FIXED", accountName: "Rent" },
  { name: "Salary", type: "MONTHLY_FIXED", accountName: "Salary" },
  { name: "Electricity", type: "VARIABLE", accountName: "Utilities" },
  { name: "Internet", type: "MONTHLY_FIXED", accountName: "Utilities" },
  { name: "Transport", type: "VARIABLE", role: "TRANSPORT" },
  { name: "Labour", type: "VARIABLE", role: "MISC" },
  { name: "Marketing", type: "VARIABLE", accountName: "Marketing & Offers" },
  { name: "Miscellaneous", type: "MISC", role: "MISC" },
];

const text = (value: Prisma.Decimal | null | undefined) => decimalString(value ?? zero(), 2);

// ---- categories -------------------------------------------------------------------------------------------------------------------------------

/** A shop that has no category yet gets the usual ones (each on the expense account of the chart that fits). */
export async function ensureCategories(organizationId: string) {
  if ((await prisma.expenseCategory.count({ where: { organizationId } })) > 0) {
    return;
  }
  const roles = await prisma.accountRole.findMany({ where: { organizationId, role: { in: ["TRANSPORT", "MISC"] } }, select: { role: true, accountId: true } });
  const byRole = new Map<string, string>(roles.map((row) => [row.role, row.accountId]));
  const named = await prisma.account.findMany({ where: { organizationId, group: { code: GROUP.EXPENSE }, name: { in: DEFAULT_CATEGORIES.flatMap((category) => (category.accountName ? [category.accountName] : [])) } }, select: { id: true, name: true } });
  const byName = new Map(named.map((account) => [account.name, account.id]));
  const data = DEFAULT_CATEGORIES.flatMap((category) => {
    const accountId = category.role ? byRole.get(category.role) : byName.get(category.accountName ?? "");
    return accountId ? [{ organizationId, name: category.name, accountId, type: category.type }] : [];
  });
  if (data.length > 0) {
    await prisma.expenseCategory.createMany({ data, skipDuplicates: true });
  }
}

export async function listCategories(organizationId: string) {
  await ensureCategories(organizationId);
  const rows = await prisma.expenseCategory.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  const accounts = await prisma.account.findMany({ where: { organizationId, id: { in: [...new Set(rows.map((row) => row.accountId))] } }, select: { id: true, code: true, name: true } });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return rows.map((row) => ({ id: row.id, name: row.name, type: row.type, status: row.status, accountId: row.accountId, accountCode: byId.get(row.accountId)?.code ?? "", accountName: byId.get(row.accountId)?.name ?? "" }));
}

/** The expense accounts of the chart a category can post to. */
export async function listExpenseAccounts(organizationId: string) {
  const rows = await prisma.account.findMany({ where: { organizationId, status: "ACTIVE", group: { code: GROUP.EXPENSE } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  return rows;
}

export async function saveCategory(who: Who, input: { id?: string; name: string; accountId: string; type: ExpenseType; active?: boolean }) {
  try {
    const name = input.name.trim();
    if (!name || name.length > 191) {
      throw new RuleError("Give the category a name.");
    }
    const account = await prisma.account.findFirst({ where: { id: input.accountId, organizationId: who.organizationId, status: "ACTIVE", group: { code: GROUP.EXPENSE } }, select: { id: true } });
    if (!account) {
      throw new RuleError("Choose an active expense account.");
    }
    const data = { name, accountId: account.id, type: input.type, ...(input.active === undefined ? {} : { status: input.active ? ("ACTIVE" as const) : ("INACTIVE" as const) }) };
    let id = input.id;
    if (id) {
      const found = await prisma.expenseCategory.findFirst({ where: { id, organizationId: who.organizationId }, select: { id: true } });
      if (!found) {
        throw new RuleError("That record was not found.", 404);
      }
      await prisma.expenseCategory.update({ where: { id }, data });
    } else {
      id = (await prisma.expenseCategory.create({ data: { organizationId: who.organizationId, ...data }, select: { id: true } })).id;
    }
    await writeAudit({ organizationId: who.organizationId, branchId: who.branchId, userId: who.userId, action: "expense category", module: "accounting", entityType: "expense_category", entityId: id, after: { name, type: input.type }, ip: who.ip, userAgent: who.userAgent });
    return { ok: true as const, id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

async function categoryOf(db: Prisma.TransactionClient, organizationId: string, id: string) {
  const category = await db.expenseCategory.findFirst({ where: { id, organizationId, status: "ACTIVE" }, select: { id: true, name: true, accountId: true } });
  if (!category) {
    throw new RuleError("Choose an active expense category.", 422);
  }
  return category;
}

// ---- posting ----------------------------------------------------------------------------------------------------------------------------------

/** Money out: Dr what is paid (the expense, or the accrual) / Dr the bank or mobile charge / Cr the account the money left (the amount and the charge). */
async function postOut(
  tx: Prisma.TransactionClient,
  p: { organizationId: string; branchId: string; userId: string; date: string; docType: "EXPENSE" | "EXPENSE_SETTLEMENT"; docId: string; number: string | null; description: string; debitAccountId: string; amount: Prisma.Decimal; charge: Prisma.Decimal; money: MoneyAccount },
) {
  const journalId = await postBalancedJournal(tx, {
    organizationId: p.organizationId,
    branchId: p.branchId,
    businessDate: occurredDate(p.date),
    description: p.description,
    createdById: p.userId,
    doc: { type: p.docType, id: p.docId },
    number: p.number,
    lines: [
      { accountId: p.debitAccountId, debit: p.amount, credit: zero() },
      ...chargeLines(p.money.kind, p.charge),
      { accountId: p.money.id, debit: zero(), credit: p.amount.plus(p.charge) },
    ],
  });
  // The cash drawer line carries the shift the posting engine attached; the expense remembers which.
  const shift = p.money.kind === "CASH" ? await tx.journalLine.findFirst({ where: { journalId, shiftId: { not: null } }, select: { shiftId: true } }) : null;
  return { journalId, shiftId: shift?.shiftId ?? null };
}

async function finish(input: Who, data: { id: string; replayed: boolean; number: string | null }, action: string) {
  if (!data.replayed) {
    await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action, module: "accounting", entityType: "expense", entityId: data.id, after: { number: data.number }, ip: input.ip, userAgent: input.userAgent });
  }
  return { ok: true as const, ...data };
}

async function lockExpense(tx: Prisma.TransactionClient, organizationId: string, branchId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM expenses WHERE id = ${id} AND organizationId = ${organizationId} AND branchId = ${branchId} FOR UPDATE`;
  if (rows.length === 0) {
    throw new RuleError("That record was not found.", 404);
  }
  return tx.expense.findUniqueOrThrow({ where: { id } });
}

type PayInput = Actor & { businessDate: string; moneyAccountId: string; amount: string; charge?: string; note?: string };

/** A new expense, paid now: the category's expense account is debited and the cash, bank or mobile account the money left is credited. */
export async function payExpense(input: PayInput & { categoryId: string; periodMonth?: string }) {
  const requestHash = hashPayload({ date: input.businessDate, category: input.categoryId, amount: input.amount, money: input.moneyAccountId, charge: input.charge ?? "", month: input.periodMonth ?? "", note: input.note ?? "" });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, number: null as string | null, replayed: true };
      }
      const date = checkDate(input.businessDate);
      const period = checkMonth(input.periodMonth || monthOf(date));
      const amount = amountOf(input.amount, "the amount");
      if (amount.lte(0)) {
        throw new RuleError("Enter an amount greater than zero.");
      }
      const charge = amountOf(input.charge, "the charge");
      const category = await categoryOf(tx, input.organizationId, input.categoryId);
      const money = await moneyAccountOf(tx, input.organizationId, input.moneyAccountId);
      checkCharge(money.kind, charge);
      const id = randomUUID();
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "EXP", businessDate: date });
      const posted = await postOut(tx, { ...input, date, docType: "EXPENSE", docId: id, number, description: `Expense ${number}: ${category.name}`, debitAccountId: category.accountId, amount, charge, money });
      await tx.expense.create({
        data: {
          id,
          organizationId: input.organizationId,
          branchId: input.branchId,
          accountId: category.accountId,
          categoryId: category.id,
          number,
          amount,
          charge,
          status: "PAID",
          moneyAccountId: money.id,
          periodMonth: period,
          shiftId: posted.shiftId,
          businessDate: occurredDate(date),
          journalId: posted.journalId,
          note: input.note?.trim() || null,
        },
      });
      await remember(tx, { ...input, requestHash, entityType: "expense", entityId: id });
      return { id, number, replayed: false };
    });
    return await finish(input, data, "expense pay");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/** The "pay" button on a draft (rent for the month): the amount may be changed (the electricity bill is not the same every month). */
export async function payDraft(input: PayInput & { expenseId: string }) {
  const requestHash = hashPayload({ expense: input.expenseId, date: input.businessDate, amount: input.amount, money: input.moneyAccountId, charge: input.charge ?? "", note: input.note ?? "" });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, number: null as string | null, replayed: true };
      }
      const draft = await lockExpense(tx, input.organizationId, input.branchId, input.expenseId);
      if (draft.status !== "DRAFT") {
        throw new RuleError("That expense was already paid or booked as owed.", 409);
      }
      const date = checkDate(input.businessDate);
      const amount = amountOf(input.amount || text(draft.amount), "the amount");
      if (amount.lte(0)) {
        throw new RuleError("Enter an amount greater than zero.");
      }
      const charge = amountOf(input.charge, "the charge");
      const money = await moneyAccountOf(tx, input.organizationId, input.moneyAccountId);
      checkCharge(money.kind, charge);
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "EXP", businessDate: date });
      const category = draft.categoryId ? await tx.expenseCategory.findUnique({ where: { id: draft.categoryId }, select: { name: true } }) : null;
      const posted = await postOut(tx, { ...input, date, docType: "EXPENSE", docId: draft.id, number, description: `Expense ${number}: ${category?.name ?? "expense"}`, debitAccountId: draft.accountId, amount, charge, money });
      await tx.expense.update({
        where: { id: draft.id },
        data: { number, amount, charge, status: "PAID", moneyAccountId: money.id, shiftId: posted.shiftId, businessDate: occurredDate(date), journalId: posted.journalId, ...(input.note?.trim() ? { note: input.note.trim() } : {}) },
      });
      await remember(tx, { ...input, requestHash, entityType: "expense", entityId: draft.id });
      return { id: draft.id, number, replayed: false };
    });
    return await finish(input, data, "expense pay");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/**
 * Month end: what is still a draft for that month is owed, not unpaid-and-forgotten. Each becomes Dr the expense / Cr 2400 Accrued Expenses, dated the
 * last day of the month (or today, for the month that is still running), so the month's cost is in the month's books (#30). The owner does this.
 */
export async function accrueMonth(input: Actor & { periodMonth: string }) {
  const requestHash = hashPayload({ accrue: input.periodMonth });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { count: Number(existing.entityId), total: "0.00", replayed: true };
      }
      const month = checkMonth(input.periodMonth);
      const now = today();
      const last = lastDayOfMonth(month);
      const date = last > now ? now : last;
      const drafts = await tx.expense.findMany({ where: { organizationId: input.organizationId, branchId: input.branchId, periodMonth: month, status: "DRAFT" }, orderBy: { createdAt: "asc" }, select: { id: true } });
      const accrued = await accountFor(tx, input.organizationId, "ACCRUED");
      let total = zero();
      for (const row of drafts) {
        const draft = await lockExpense(tx, input.organizationId, input.branchId, row.id);
        if (draft.status !== "DRAFT") {
          continue;
        }
        const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "EXP", businessDate: date });
        const journalId = await postBalancedJournal(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: occurredDate(date),
          description: `Expense ${number} owed for ${month}`,
          createdById: input.userId,
          doc: { type: "EXPENSE", id: draft.id },
          number,
          lines: [
            { accountId: draft.accountId, debit: draft.amount, credit: zero() },
            { accountId: accrued, debit: zero(), credit: draft.amount },
          ],
        });
        await tx.expense.update({ where: { id: draft.id }, data: { number, status: "ACCRUED", businessDate: occurredDate(date), journalId } });
        total = total.plus(draft.amount);
      }
      await remember(tx, { ...input, requestHash, entityType: "expense_accrual", entityId: String(drafts.length) });
      return { count: drafts.length, total: text(total), replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "expense accrue", module: "accounting", entityType: "expense", entityId: input.periodMonth, after: { month: input.periodMonth, count: data.count, total: data.total }, ip: input.ip, userAgent: input.userAgent });
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

/** Paying what was booked as owed: Dr 2400 Accrued Expenses / Cr the money account (the expense itself was counted in its month already). */
export async function settleAccrued(input: Actor & { expenseId: string; businessDate: string; moneyAccountId: string; charge?: string }) {
  const requestHash = hashPayload({ expense: input.expenseId, date: input.businessDate, money: input.moneyAccountId, charge: input.charge ?? "" });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, number: null as string | null, replayed: true };
      }
      const owed = await lockExpense(tx, input.organizationId, input.branchId, input.expenseId);
      if (owed.status !== "ACCRUED" || owed.settleJournalId) {
        throw new RuleError("Only an expense booked as owed can be settled, and only once.", 409);
      }
      const date = checkDate(input.businessDate);
      const charge = amountOf(input.charge, "the charge");
      const money = await moneyAccountOf(tx, input.organizationId, input.moneyAccountId);
      checkCharge(money.kind, charge);
      const accrued = await accountFor(tx, input.organizationId, "ACCRUED");
      const posted = await postOut(tx, { ...input, date, docType: "EXPENSE_SETTLEMENT", docId: owed.id, number: null, description: `Paid the expense that was owed${owed.number ? ` (${owed.number})` : ""}`, debitAccountId: accrued, amount: owed.amount, charge, money });
      await tx.expense.update({ where: { id: owed.id }, data: { status: "PAID", charge, moneyAccountId: money.id, shiftId: posted.shiftId, settleJournalId: posted.journalId, settledOn: occurredDate(date) } });
      await remember(tx, { ...input, requestHash, entityType: "expense", entityId: owed.id });
      return { id: owed.id, number: owed.number, replayed: false };
    });
    return await finish(input, data, "expense settle");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

// ---- recurring expenses -----------------------------------------------------------------------------------------------------------------------

export async function saveRecurring(who: Who, input: { id?: string; categoryId: string; amount: string; dayOfMonth: number; note?: string; active?: boolean }) {
  try {
    const amount = amountOf(input.amount, "the amount");
    if (amount.lte(0)) {
      throw new RuleError("Enter an amount greater than zero.");
    }
    if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) {
      throw new RuleError("The day of the month is between 1 and 31.");
    }
    const category = await prisma.expenseCategory.findFirst({ where: { id: input.categoryId, organizationId: who.organizationId, status: "ACTIVE" }, select: { id: true } });
    if (!category) {
      throw new RuleError("Choose an active expense category.");
    }
    const data = { categoryId: category.id, amount, dayOfMonth: input.dayOfMonth, note: input.note?.trim() || null, ...(input.active === undefined ? {} : { active: input.active }) };
    let id = input.id;
    if (id) {
      const found = await prisma.recurringExpense.findFirst({ where: { id, organizationId: who.organizationId, branchId: who.branchId }, select: { id: true } });
      if (!found) {
        throw new RuleError("That record was not found.", 404);
      }
      await prisma.recurringExpense.update({ where: { id }, data });
    } else {
      id = (await prisma.recurringExpense.create({ data: { organizationId: who.organizationId, branchId: who.branchId, ...data }, select: { id: true } })).id;
    }
    await writeAudit({ organizationId: who.organizationId, branchId: who.branchId, userId: who.userId, action: "recurring expense", module: "accounting", entityType: "recurring_expense", entityId: id, after: { amount: input.amount, dayOfMonth: input.dayOfMonth }, ip: who.ip, userAgent: who.userAgent });
    return { ok: true as const, id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function listRecurring(organizationId: string, branchId: string) {
  const rows = await prisma.recurringExpense.findMany({ where: { organizationId, branchId }, orderBy: { createdAt: "asc" }, include: { category: { select: { name: true } } } });
  return rows.map((row) => ({ id: row.id, categoryId: row.categoryId, category: row.category.name, amount: text(row.amount), dayOfMonth: row.dayOfMonth, active: row.active, note: row.note }));
}

/**
 * The draft for each recurring expense of `periodMonth` (at the start of the month, or when the page is opened). It makes only the ones that are
 * missing, so asking again is harmless: a month has one draft per recurring expense.
 */
export async function generateDrafts(who: { organizationId: string; branchId: string }, periodMonth: string) {
  const month = checkMonth(periodMonth);
  const recurring = await prisma.recurringExpense.findMany({ where: { organizationId: who.organizationId, branchId: who.branchId, active: true, category: { status: "ACTIVE" } }, include: { category: { select: { accountId: true } } } });
  if (recurring.length === 0) {
    return { created: 0 };
  }
  const result = await prisma.expense.createMany({
    skipDuplicates: true,
    data: recurring.map((row) => ({
      id: randomUUID(),
      organizationId: who.organizationId,
      branchId: who.branchId,
      accountId: row.category.accountId,
      categoryId: row.categoryId,
      amount: row.amount,
      status: "DRAFT" as ExpenseStatus,
      periodMonth: month,
      recurringId: row.id,
      businessDate: occurredDate(dateInMonth(month, row.dayOfMonth)),
      note: row.note,
    })),
  });
  return { created: result.count };
}

// ---- lists and the report ---------------------------------------------------------------------------------------------------------------------

export async function listExpenseRows(organizationId: string, branchId: string, filter: { periodMonth?: string; status?: ExpenseStatus } = {}) {
  const rows = await prisma.expense.findMany({
    where: { organizationId, branchId, ...(filter.periodMonth ? { periodMonth: filter.periodMonth } : {}), ...(filter.status ? { status: filter.status } : {}) },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: 300,
    include: { category: { select: { name: true } }, account: { select: { code: true, name: true } } },
  });
  const moneyIds = [...new Set(rows.flatMap((row) => (row.moneyAccountId ? [row.moneyAccountId] : [])))];
  const money = moneyIds.length > 0 ? await prisma.account.findMany({ where: { id: { in: moneyIds } }, select: { id: true, name: true } }) : [];
  const moneyName = new Map(money.map((account) => [account.id, account.name]));
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    category: row.category?.name ?? row.account.name,
    accountCode: row.account.code,
    amount: text(row.amount),
    charge: text(row.charge),
    periodMonth: row.periodMonth ?? monthOf(dateOnly(row.businessDate)),
    businessDate: dateOnly(row.businessDate),
    settledOn: row.settledOn ? dateOnly(row.settledOn) : null,
    paidFrom: row.moneyAccountId ? (moneyName.get(row.moneyAccountId) ?? null) : null,
    recurring: row.recurringId !== null,
    note: row.note,
  }));
}

/**
 * What each month cost, by category: the expenses that belong to the month (periodMonth), however late they were paid. Paid and owed both count (the
 * cost is real); a draft is only waiting, so it is shown apart. Older rows without a periodMonth belong to the month they were dated.
 */
export async function expenseReport(organizationId: string, branchId: string, fromMonth: string, toMonth: string) {
  const from = checkMonth(fromMonth);
  const to = checkMonth(toMonth);
  const rows = await prisma.$queryRaw<Array<{ month: string; categoryId: string | null; accountId: string; status: ExpenseStatus; amount: Prisma.Decimal; charge: Prisma.Decimal }>>`
    SELECT COALESCE(e.periodMonth, DATE_FORMAT(e.businessDate, '%Y-%m')) AS month, e.categoryId AS categoryId, e.accountId AS accountId, e.status AS status,
           SUM(e.amount) AS amount, SUM(e.charge) AS charge
    FROM expenses e
    WHERE e.organizationId = ${organizationId} AND e.branchId = ${branchId}
      AND COALESCE(e.periodMonth, DATE_FORMAT(e.businessDate, '%Y-%m')) BETWEEN ${from} AND ${to}
    GROUP BY month, e.categoryId, e.accountId, e.status
    ORDER BY month DESC
  `;
  const categories = await prisma.expenseCategory.findMany({ where: { organizationId }, select: { id: true, name: true } });
  const accounts = await prisma.account.findMany({ where: { organizationId, group: { code: GROUP.EXPENSE } }, select: { id: true, name: true } });
  const nameOf = new Map<string, string>([...accounts.map((account) => [account.id, account.name] as const), ...categories.map((category) => [category.id, category.name] as const)]);
  const lines = new Map<string, { month: string; category: string; booked: Prisma.Decimal; owed: Prisma.Decimal; draft: Prisma.Decimal; charge: Prisma.Decimal }>();
  for (const row of rows) {
    const category = (row.categoryId && nameOf.get(row.categoryId)) || nameOf.get(row.accountId) || "Other";
    const key = `${row.month}|${category}`;
    const line = lines.get(key) ?? { month: row.month, category, booked: zero(), owed: zero(), draft: zero(), charge: zero() };
    const amount = new Prisma.Decimal(row.amount);
    if (row.status === "DRAFT") {
      line.draft = line.draft.plus(amount);
    } else {
      line.booked = line.booked.plus(amount);
      if (row.status === "ACCRUED") {
        line.owed = line.owed.plus(amount);
      }
      line.charge = line.charge.plus(new Prisma.Decimal(row.charge));
    }
    lines.set(key, line);
  }
  const list = [...lines.values()].sort((a, b) => (a.month === b.month ? a.category.localeCompare(b.category) : b.month.localeCompare(a.month)));
  const sum = (pick: (line: (typeof list)[number]) => Prisma.Decimal) => list.reduce((total, line) => total.plus(pick(line)), zero());
  return {
    rows: list.map((line) => ({ month: line.month, category: line.category, booked: text(line.booked), owed: text(line.owed), draft: text(line.draft), charge: text(line.charge) })),
    totals: { booked: text(sum((line) => line.booked)), owed: text(sum((line) => line.owed)), draft: text(sum((line) => line.draft)), charge: text(sum((line) => line.charge)) },
  };
}
