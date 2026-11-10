import { Prisma } from "@prisma/client";
import { runTx } from "@/core/tx/run";
import { RuleError } from "@/core/errors/rule-error";
import { businessDate, dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { postBalancedJournal } from "@/modules/accounting/post";
import { decimalString, parseMoney } from "@/core/money";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  openingBalance: true,
  creditLimit: true,
  paymentTerms: true,
  status: true,
  customerTypeId: true,
  customerType: { select: { name: true } },
} as const;

function dateString(value: Date) {
  return dateOnly(value);
}

function today() {
  return new Date(`${businessDate()}T00:00:00.000Z`);
}

export async function outstandingReceivable(
  organizationId: string,
  customerId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const sum = await tx.customerLedger.aggregate({
    where: { organizationId, customerId },
    _sum: { debit: true, credit: true },
  });
  return new Prisma.Decimal(sum._sum.debit ?? 0).minus(sum._sum.credit ?? 0);
}

function present(
  row: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    openingBalance: Prisma.Decimal;
    creditLimit: Prisma.Decimal | null;
    paymentTerms: string | null;
    status: "ACTIVE" | "INACTIVE";
    customerTypeId: string | null;
    customerType: { name: string } | null;
  },
  outstanding: Prisma.Decimal,
) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    openingBalance: decimalString(row.openingBalance, 2),
    creditLimit: row.creditLimit ? decimalString(row.creditLimit, 2) : null,
    paymentTerms: row.paymentTerms,
    status: row.status,
    customerTypeId: row.customerTypeId,
    typeName: row.customerType?.name ?? null,
    outstanding: decimalString(outstanding, 2),
  };
}

export async function listRegisterCustomers(organizationId: string) {
  const [rows, sums] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true, phone: true },
    }),
    prisma.customerLedger.groupBy({
      by: ["customerId"],
      where: { organizationId },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const due = new Map(sums.map((row) => [row.customerId, new Prisma.Decimal(row._sum.debit ?? 0).minus(row._sum.credit ?? 0)]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    outstanding: decimalString(due.get(row.id) ?? new Prisma.Decimal(0), 2),
  }));
}

export async function listCustomers(organizationId: string, search?: string) {
  const needle = search?.trim();
  const [rows, sums] = await Promise.all([
    prisma.customer.findMany({
      where: {
        organizationId,
        ...(needle ? { OR: [{ name: { contains: needle } }, { phone: { contains: needle } }] } : {}),
      },
      orderBy: { name: "asc" },
      take: 200,
      select: customerSelect,
    }),
    prisma.customerLedger.groupBy({
      by: ["customerId"],
      where: { organizationId },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const due = new Map(sums.map((row) => [row.customerId, new Prisma.Decimal(row._sum.debit ?? 0).minus(row._sum.credit ?? 0)]));
  return rows.map((row) => present(row, due.get(row.id) ?? new Prisma.Decimal(0)));
}

export async function getCustomer(organizationId: string, id: string) {
  const row = await prisma.customer.findFirst({ where: { id, organizationId }, select: customerSelect });
  if (!row) {
    return null;
  }
  const ledger = await prisma.customerLedger.findMany({
    where: { organizationId, customerId: id },
    orderBy: { businessDate: "desc" },
    take: 50,
  });
  return {
    ...present(row, await outstandingReceivable(organizationId, id)),
    ledger: ledger.map((line) => ({
      id: line.id,
      businessDate: dateString(line.businessDate),
      entryType: line.entryType,
      debit: decimalString(line.debit, 2),
      credit: decimalString(line.credit, 2),
      referenceType: line.referenceType,
    })),
  };
}

export async function listCustomerTypes(organizationId: string) {
  const rows = await prisma.customerType.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true, status: true },
  });
  return rows;
}

async function activeType(organizationId: string, customerTypeId: string | null | undefined, keepId?: string | null) {
  if (!customerTypeId) {
    return { ok: true as const, customerTypeId: null };
  }
  const type = await prisma.customerType.findFirst({
    where: { id: customerTypeId, organizationId },
    select: { id: true, status: true },
  });
  if (!type || (type.status !== "ACTIVE" && type.id !== keepId)) {
    const failure: Failure = { ok: false, status: 422, code: "BUSINESS_RULE", message: "Choose an active customer type." };
    return failure;
  }
  return { ok: true as const, customerTypeId: type.id };
}

export async function createCustomerType(input: {
  organizationId: string;
  actorId: string;
  name: string;
  ip: string;
  userAgent: string | null;
}) {
  const name = input.name.trim();
  if (!name) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a customer type name." };
  }
  const existing = await prisma.customerType.findFirst({ where: { organizationId: input.organizationId, name }, select: { id: true } });
  if (existing) {
    return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: "That customer type already exists." };
  }
  const type = await prisma.customerType.create({
    data: { organizationId: input.organizationId, name },
    select: { id: true, name: true },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "create",
    module: "customers",
    entityType: "customer_type",
    entityId: type.id,
    after: { name: type.name },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, type };
}

export async function updateCustomerType(input: {
  organizationId: string;
  actorId: string;
  typeId: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  ip: string;
  userAgent: string | null;
}) {
  const current = await prisma.customerType.findFirst({
    where: { id: input.typeId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  const name = input.name.trim();
  if (!name) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a customer type name." };
  }
  const duplicate = await prisma.customerType.findFirst({
    where: { organizationId: input.organizationId, name, id: { not: current.id } },
    select: { id: true },
  });
  if (duplicate) {
    return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: "That customer type already exists." };
  }
  const type = await prisma.customerType.update({
    where: { id: current.id },
    data: { name, status: input.status },
    select: { id: true, name: true, status: true },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "edit",
    module: "customers",
    entityType: "customer_type",
    entityId: type.id,
    after: { name: type.name, status: type.status },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, type };
}

export async function createCustomer(input: {
  organizationId: string;
  actorId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  customerTypeId?: string | null;
  branchId?: string | null;
  openingBalance?: string | null;
  creditLimit?: string | null;
  paymentTerms?: string | null;
  ip: string;
  userAgent: string | null;
}) {
  const name = input.name.trim();
  if (!name) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a customer name." };
  }
  const opening = input.openingBalance ? parseMoney(input.openingBalance) : new Prisma.Decimal(0);
  const creditLimit = input.creditLimit ? parseMoney(input.creditLimit) : null;
  if (!opening || (input.creditLimit && !creditLimit)) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter money amounts with up to two decimals." };
  }
  const type = await activeType(input.organizationId, input.customerTypeId);
  if (!type.ok) {
    return type;
  }
  let customer: { id: string; name: string };
  try {
    customer = await runTx(async (tx) => {
    const created = await tx.customer.create({
      data: {
        organizationId: input.organizationId,
        name,
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        address: input.address?.trim() || null,
        customerTypeId: type.customerTypeId,
        openingBalance: opening,
        creditLimit,
        paymentTerms: input.paymentTerms?.trim() || null,
        createdById: input.actorId,
      },
      select: { id: true, name: true },
    });
    if (opening.gt(0)) {
      await tx.customerLedger.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId ?? null,
          customerId: created.id,
          businessDate: today(),
          entryType: "OPENING",
          debit: opening,
          referenceType: "customer",
          referenceId: created.id,
        },
      });
      if (input.branchId) {
        await postBalancedJournal(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: today(),
          description: `Customer opening ${created.name}`,
          createdById: input.actorId,
          lines: [
            { role: "AR", debit: opening, credit: new Prisma.Decimal(0) },
            { role: "CAPITAL", debit: new Prisma.Decimal(0), credit: opening },
          ],
        });
      }
    }
    return created;
  });
  } catch (error) {
    if (error instanceof RuleError) {
      return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: error.message };
    }
    throw error;
  }
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "create",
    module: "customers",
    entityType: "customer",
    entityId: customer.id,
    after: { name: customer.name },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, customer };
}

export async function updateCustomer(input: {
  organizationId: string;
  actorId: string;
  customerId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  customerTypeId?: string | null;
  creditLimit?: string | null;
  paymentTerms?: string | null;
  status: "ACTIVE" | "INACTIVE";
  ip: string;
  userAgent: string | null;
}) {
  const current = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId },
    select: { id: true, customerTypeId: true },
  });
  if (!current) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  const name = input.name.trim();
  if (!name) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a customer name." };
  }
  const creditLimit = input.creditLimit ? parseMoney(input.creditLimit) : null;
  if (input.creditLimit && !creditLimit) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a credit limit with up to two decimals." };
  }
  if (creditLimit) {
    const balance = await outstandingReceivable(input.organizationId, current.id);
    if (balance.gt(creditLimit)) {
      return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "The credit limit is below the outstanding due." };
    }
  }
  const type = await activeType(input.organizationId, input.customerTypeId, current.customerTypeId);
  if (!type.ok) {
    return type;
  }
  const customer = await prisma.customer.update({
    where: { id: current.id },
    data: {
      name,
      phone: input.phone?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      address: input.address?.trim() || null,
      customerTypeId: type.customerTypeId,
      creditLimit,
      paymentTerms: input.paymentTerms?.trim() || null,
      status: input.status,
      updatedById: input.actorId,
    },
    select: { id: true, name: true },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "edit",
    module: "customers",
    entityType: "customer",
    entityId: customer.id,
    after: { name: customer.name, status: input.status },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, customer };
}

export async function listCustomerInvoices(organizationId: string, branchId: string) {
  const rows = await prisma.invoice.findMany({
    where: { organizationId, branchId, customerId: { not: null } },
    orderBy: { issuedAt: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      total: true,
      customerId: true,
      sale: { select: { id: true, businessDate: true, status: true, customer: { select: { name: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    saleId: row.sale.id,
    number: row.number,
    customerId: row.customerId,
    customerName: row.sale.customer?.name ?? "",
    businessDate: dateString(row.sale.businessDate),
    status: row.sale.status,
    total: decimalString(row.total, 2),
  }));
}
