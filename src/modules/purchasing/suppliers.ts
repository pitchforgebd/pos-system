import { Prisma } from "@prisma/client";
import { runTx } from "@/core/tx/run";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { postBalancedJournal } from "@/modules/accounting/post";
import { decimalString, parseMoney } from "@/core/money";

const supplierSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  openingPayable: true,
  creditLimit: true,
  paymentTerms: true,
  status: true,
} as const;

function present(row: {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  openingPayable: Prisma.Decimal;
  creditLimit: Prisma.Decimal | null;
  paymentTerms: string | null;
  status: "ACTIVE" | "INACTIVE";
}, outstanding: Prisma.Decimal) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    openingPayable: decimalString(row.openingPayable, 2),
    creditLimit: row.creditLimit ? decimalString(row.creditLimit, 2) : null,
    paymentTerms: row.paymentTerms,
    status: row.status,
    outstanding: decimalString(outstanding, 2),
  };
}

export async function outstandingPayable(organizationId: string, supplierId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const sum = await tx.supplierLedger.aggregate({
    where: { organizationId, supplierId },
    _sum: { debit: true, credit: true },
  });
  return new Prisma.Decimal(sum._sum.credit ?? 0).minus(sum._sum.debit ?? 0);
}

export async function listSuppliers(organizationId: string) {
  const [rows, sums] = await Promise.all([
    prisma.supplier.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: supplierSelect,
    }),
    prisma.supplierLedger.groupBy({
      by: ["supplierId"],
      where: { organizationId },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const due = new Map(sums.map((row) => [row.supplierId, new Prisma.Decimal(row._sum.credit ?? 0).minus(row._sum.debit ?? 0)]));
  return rows.map((row) => present(row, due.get(row.id) ?? new Prisma.Decimal(0)));
}

export async function getSupplier(organizationId: string, id: string) {
  const row = await prisma.supplier.findFirst({ where: { id, organizationId }, select: supplierSelect });
  if (!row) {
    return null;
  }
  const ledger = await prisma.supplierLedger.findMany({
    where: { organizationId, supplierId: id },
    orderBy: { businessDate: "desc" },
    take: 50,
  });
  return {
    ...present(row, await outstandingPayable(organizationId, id)),
    ledger: ledger.map((entry) => ({
      id: entry.id,
      businessDate: dateOnly(entry.businessDate),
      entryType: entry.entryType,
      debit: decimalString(entry.debit, 2),
      credit: decimalString(entry.credit, 2),
      referenceType: entry.referenceType,
    })),
  };
}

export async function createSupplier(input: {
  organizationId: string;
  actorId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  branchId?: string | null;
  openingPayable: string;
  creditLimit?: string | null;
  paymentTerms?: string | null;
  ip: string;
  userAgent: string | null;
}) {
  const opening = parseMoney(input.openingPayable);
  const creditLimit = input.creditLimit ? parseMoney(input.creditLimit) : null;
  if (!opening || (input.creditLimit && !creditLimit)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter money amounts with up to two decimals." };
  }
  const supplier = await runTx(async (tx) => {
    const created = await tx.supplier.create({
    data: {
      organizationId: input.organizationId,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      address: input.address?.trim() || null,
      openingPayable: opening,
      creditLimit,
      paymentTerms: input.paymentTerms?.trim() || null,
      createdById: input.actorId,
    },
    select: supplierSelect,
  });
  if (opening.gt(0)) {
    await tx.supplierLedger.create({
      data: {
        organizationId: input.organizationId,
        supplierId: created.id,
        businessDate: new Date(),
        entryType: "OPENING",
        credit: opening,
        referenceType: "supplier",
        referenceId: created.id,
      },
    });
    if (input.branchId) {
      await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: new Date(),
        description: `Supplier opening ${created.name}`,
        createdById: input.actorId,
        lines: [
          { role: "CAPITAL", debit: opening, credit: new Prisma.Decimal(0) },
          { role: "AP", debit: new Prisma.Decimal(0), credit: opening, party: { type: "VENDOR" as const, id: created.id } },
        ],
        doc: { type: "SUPPLIER_OPENING", id: created.id },
      });
    }
  }
  return created;
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "create",
    module: "suppliers",
    entityType: "supplier",
    entityId: supplier.id,
    after: { name: supplier.name },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, supplier: present(supplier, opening) };
}

export async function updateSupplier(input: {
  organizationId: string;
  actorId: string;
  supplierId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  creditLimit?: string | null;
  paymentTerms?: string | null;
  status: "ACTIVE" | "INACTIVE";
  ip: string;
  userAgent: string | null;
}) {
  const current = await prisma.supplier.findFirst({
    where: { id: input.supplierId, organizationId: input.organizationId },
    select: { id: true, name: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  const creditLimit = input.creditLimit ? parseMoney(input.creditLimit) : null;
  if (input.creditLimit && !creditLimit) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a credit limit with up to two decimals." };
  }
  if (creditLimit) {
    const balance = await outstandingPayable(input.organizationId, current.id);
    if (balance.gt(creditLimit)) {
      return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "The credit limit is below the outstanding payable." };
    }
  }
  const supplier = await prisma.supplier.update({
    where: { id: current.id },
    data: {
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      address: input.address?.trim() || null,
      creditLimit,
      paymentTerms: input.paymentTerms?.trim() || null,
      status: input.status,
      updatedById: input.actorId,
    },
    select: supplierSelect,
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "update",
    module: "suppliers",
    entityType: "supplier",
    entityId: supplier.id,
    before: { name: current.name },
    after: { name: supplier.name, status: supplier.status },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, supplier: present(supplier, await outstandingPayable(input.organizationId, supplier.id)) };
}
