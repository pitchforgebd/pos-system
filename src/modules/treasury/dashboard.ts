import { Prisma } from "@prisma/client";

import { MONEY_KINDS } from "@/core/ledger/accounts";
import { GROUP } from "@/core/ledger/groups";
import { decimalString, zero } from "@/core/money";
import { dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { occurredDate } from "@/lib/format/date";

// The Bank & Cash dashboard (P08 task 7): each cash, bank and mobile account with what it holds now, what came in and went out on the day, and the
// transfers between them. The ledger of one account is its statement (accounting/statements).

const text = (value: Prisma.Decimal) => decimalString(value, 2);

export async function moneyDashboard(organizationId: string, branchId: string, date: string) {
  const accounts = await prisma.account.findMany({
    where: { organizationId, status: "ACTIVE", kind: { in: [...MONEY_KINDS] } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, kind: true, accountNumber: true, bankName: true, bankBranch: true },
  });
  if (accounts.length === 0) {
    return { date, accounts: [], totals: { balance: "0.00", received: "0.00", paid: "0.00" } };
  }
  const ids = accounts.map((account) => account.id);
  const [held, onDay] = await Promise.all([
    prisma.journalLine.groupBy({ by: ["accountId"], where: { organizationId, accountId: { in: ids }, journal: { status: "POSTED", branchId } }, _sum: { debit: true, credit: true } }),
    prisma.journalLine.groupBy({ by: ["accountId"], where: { organizationId, accountId: { in: ids }, journal: { status: "POSTED", branchId, businessDate: occurredDate(date) } }, _sum: { debit: true, credit: true } }),
  ]);
  const balance = new Map(held.map((row) => [row.accountId, new Prisma.Decimal(row._sum.debit ?? 0).minus(row._sum.credit ?? 0)]));
  const day = new Map(onDay.map((row) => [row.accountId, { received: new Prisma.Decimal(row._sum.debit ?? 0), paid: new Prisma.Decimal(row._sum.credit ?? 0) }]));
  const rows = accounts.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    kind: account.kind as "CASH" | "BANK" | "MOBILE",
    accountNumber: account.accountNumber,
    bank: [account.bankName, account.bankBranch].filter(Boolean).join(" · "),
    balance: balance.get(account.id) ?? zero(),
    received: day.get(account.id)?.received ?? zero(),
    paid: day.get(account.id)?.paid ?? zero(),
  }));
  const sum = (pick: (row: (typeof rows)[number]) => Prisma.Decimal) => rows.reduce((total, row) => total.plus(pick(row)), zero());
  return {
    date,
    accounts: rows.map((row) => ({ ...row, balance: text(row.balance), received: text(row.received), paid: text(row.paid) })),
    totals: { balance: text(sum((row) => row.balance)), received: text(sum((row) => row.received)), paid: text(sum((row) => row.paid)) },
  };
}

/** The latest transfers between the shop's own accounts. */
export async function listTransfers(organizationId: string, branchId: string) {
  const rows = await prisma.contraTransfer.findMany({ where: { organizationId, branchId }, orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }], take: 50 });
  const ids = [...new Set(rows.flatMap((row) => [row.fromAccountId, row.toAccountId]))];
  const accounts = ids.length > 0 ? await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(accounts.map((account) => [account.id, account.name]));
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    businessDate: dateOnly(row.businessDate),
    from: name.get(row.fromAccountId) ?? "",
    to: name.get(row.toAccountId) ?? "",
    amount: text(row.amount),
    charge: text(row.charge),
    note: row.note,
    journalId: row.journalId,
  }));
}

/** The cash, bank and mobile accounts a payment can go through, for the pickers (with their kind, so a form knows which have a charge). */
export async function moneyPickerOptions(organizationId: string) {
  const rows = await prisma.account.findMany({ where: { organizationId, status: "ACTIVE", kind: { in: [...MONEY_KINDS] } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, kind: true } });
  return rows.map((row) => ({ id: row.id, label: `${row.name} (${row.code})`, kind: row.kind as "CASH" | "BANK" | "MOBILE" }));
}

/**
 * The accounts the other side of a cash in or out can be: the shop's other money accounts, the owner (capital in, drawings out), an expense account
 * (cash out for tea, stamps) or an income account (cash in that is not a sale). The drawer's own account is left out.
 */
export async function counterAccountOptions(organizationId: string, exceptAccountId?: string | null) {
  const owner = await prisma.accountRole.findMany({ where: { organizationId, role: { in: ["CAPITAL", "DRAWINGS"] } }, select: { accountId: true } });
  const rows = await prisma.account.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      ...(exceptAccountId ? { id: { not: exceptAccountId } } : {}),
      OR: [{ kind: { in: [...MONEY_KINDS] } }, { id: { in: owner.map((row) => row.accountId) } }, { group: { code: { in: [GROUP.EXPENSE, GROUP.REVENUE] } } }],
    },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, kind: true, group: { select: { code: true } } },
  });
  const sales = await prisma.accountRole.findFirst({ where: { organizationId, role: "SALES" }, select: { accountId: true } });
  const ownerIds = new Set(owner.map((row) => row.accountId));
  const groupOf = (row: (typeof rows)[number]) => (row.kind !== "OTHER" ? "Money accounts" : ownerIds.has(row.id) ? "Owner" : row.group.code === GROUP.EXPENSE ? "Expenses" : "Income");
  return rows.filter((row) => row.id !== sales?.accountId).map((row) => ({ id: row.id, label: `${row.name} (${row.code})`, group: groupOf(row) }));
}
