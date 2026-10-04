import { prisma } from "@/lib/db/client";
import { decimalString } from "@/modules/inventory/money";

export async function listIncomeRows(organizationId: string, branchId: string) {
  const rows = await prisma.income.findMany({
    where: { organizationId, branchId },
    orderBy: { occurredOn: "desc" },
    take: 100,
    select: { id: true, category: true, amount: true, occurredOn: true, journalId: true },
  });
  return rows.map((row) => ({
    id: row.id,
    category: row.category ?? "",
    amount: decimalString(row.amount, 2),
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    posted: row.journalId ? "Posted" : "Not posted",
  }));
}

export async function listLoanMovements(organizationId: string, branchId: string) {
  const rows = await prisma.journalLine.findMany({
    where: { organizationId, account: { code: "2200" }, journal: { status: "POSTED", branchId } },
    orderBy: { journal: { occurredOn: "desc" } },
    take: 100,
    select: { id: true, debit: true, credit: true, journal: { select: { number: true, description: true, occurredOn: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    occurredOn: row.journal.occurredOn.toISOString().slice(0, 10),
    number: row.journal.number ?? "",
    description: row.journal.description ?? "",
    debit: decimalString(row.debit, 2),
    credit: decimalString(row.credit, 2),
  }));
}

export async function listLoanRows(organizationId: string) {
  const rows = await prisma.loan.findMany({
    where: { organizationId },
    orderBy: { lender: "asc" },
    take: 100,
    select: { id: true, lender: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    lender: row.lender,
    createdOn: row.createdAt.toISOString().slice(0, 10),
  }));
}

export async function listCapitalRows(organizationId: string, branchId: string) {
  const rows = await prisma.capitalTransaction.findMany({
    where: { organizationId, branchId },
    orderBy: { occurredOn: "desc" },
    take: 100,
    select: { id: true, capitalType: true, ownerName: true, amount: true, occurredOn: true, journalId: true },
  });
  return rows.map((row) => ({
    id: row.id,
    capitalType: row.capitalType,
    ownerName: row.ownerName,
    amount: decimalString(row.amount, 2),
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    posted: row.journalId ? "Posted" : "Not posted",
  }));
}
