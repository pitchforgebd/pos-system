import { nextPartyCode, paymentDaysOf, phoneOf, placeOf, samePhone, tagsOf } from "@/modules/parties/profile";
import { Prisma } from "@prisma/client";
import { runTx } from "@/core/tx/run";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";
import { openingDate } from "@/core/time/opening";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { partyBalance, partyBalances, recentPartyLines } from "@/core/parties";
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
  code: true,
  businessName: true,
  altPhone: true,
  nid: true,
  districtId: true,
  upazilaId: true,
  tags: true,
  smsOptOut: true,
  paymentDays: true,
} as const;

function dateString(value: Date) {
  return dateOnly(value);
}

/** What the customer owes the shop: the balance of their receivable lines in the journal (I8). An advance is not netted against it. */
export async function outstandingReceivable(
  organizationId: string,
  customerId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return partyBalance(tx as Prisma.TransactionClient, { organizationId, partyType: "CUSTOMER", partyId: customerId });
}

/** The customer's wallet: the advance the shop holds for them, from the Customer Advance lines in the journal. */
export async function customerWallet(
  organizationId: string,
  customerId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return partyBalance(tx as Prisma.TransactionClient, { organizationId, partyType: "CUSTOMER", partyId: customerId, account: "ADVANCE" });
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
    code: string;
    businessName: string | null;
    altPhone: string | null;
    nid: string | null;
    districtId: number | null;
    upazilaId: number | null;
    tags: string | null;
    smsOptOut: boolean;
    paymentDays: number | null;
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
    code: row.code,
    businessName: row.businessName,
    altPhone: row.altPhone,
    nid: row.nid,
    districtId: row.districtId,
    upazilaId: row.upazilaId,
    tags: row.tags,
    smsOptOut: row.smsOptOut,
    paymentDays: row.paymentDays,
    outstanding: decimalString(outstanding, 2),
  };
}

export async function listRegisterCustomers(organizationId: string) {
  const rows = await prisma.customer.findMany({
    where: { organizationId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, phone: true },
  });
  // Only the rows shown get a balance (H8), and it comes from the journal.
  const balances = await partyBalances(prisma, { organizationId, partyType: "CUSTOMER", partyIds: rows.map((row) => row.id) });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    outstanding: decimalString(balances.get(row.id)?.balance ?? new Prisma.Decimal(0), 2),
  }));
}

export async function listCustomers(organizationId: string, search?: string) {
  const needle = search?.trim();
  const rows = await prisma.customer.findMany({
    where: {
      organizationId,
      ...(needle ? { OR: [{ name: { contains: needle } }, { phone: { contains: needle } }] } : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
    select: customerSelect,
  });
  const balances = await partyBalances(prisma, { organizationId, partyType: "CUSTOMER", partyIds: rows.map((row) => row.id) });
  return rows.map((row) => present(row, balances.get(row.id)?.balance ?? new Prisma.Decimal(0)));
}

export async function getCustomer(organizationId: string, id: string) {
  const row = await prisma.customer.findFirst({ where: { id, organizationId }, select: customerSelect });
  if (!row) {
    return null;
  }
  return {
    ...present(row, await outstandingReceivable(organizationId, id)),
    wallet: decimalString(await customerWallet(organizationId, id), 2),
    ledger: await recentPartyLines(prisma, { organizationId, partyType: "CUSTOMER", partyId: id }),
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
  businessName?: string | null;
  altPhone?: string | null;
  nid?: string | null;
  districtId?: number | null;
  upazilaId?: number | null;
  tags?: string | null;
  smsOptOut?: boolean;
  paymentDays?: number | null;
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
  if (opening.gt(0) && !input.branchId) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Select a branch before entering an opening balance: it is posted to the books." };
  }
  const type = await activeType(input.organizationId, input.customerTypeId);
  if (!type.ok) {
    return type;
  }
  let customer: { id: string; name: string; code: string; phone: string | null };
  try {
    customer = await runTx(async (tx) => {
    const details = await detailsOf(tx, input, false);
    const created = await tx.customer.create({
      data: {
        organizationId: input.organizationId,
        code: await nextPartyCode(tx, input.organizationId, "CUSTOMER"),
        name,
        ...details,
        email: input.email?.trim().toLowerCase() || null,
        address: input.address?.trim() || null,
        customerTypeId: type.customerTypeId,
        openingBalance: opening,
        creditLimit,
        paymentTerms: input.paymentTerms?.trim() || null,
        createdById: input.actorId,
      },
      select: { id: true, name: true, code: true, phone: true },
    });
    if (opening.gt(0)) {
      if (input.branchId) {
        await postBalancedJournal(tx, {
          organizationId: input.organizationId,
          branchId: input.branchId,
          businessDate: new Date(`${await openingDate(tx, input.organizationId)}T00:00:00.000Z`),
          description: `Customer opening ${created.name}`,
          createdById: input.actorId,
          lines: [
            { role: "AR", debit: opening, credit: new Prisma.Decimal(0), party: { type: "CUSTOMER" as const, id: created.id } },
            { role: "OPENING_EQUITY", debit: new Prisma.Decimal(0), credit: opening },
          ],
          doc: { type: "CUSTOMER_OPENING", id: created.id },
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
    after: { name: customer.name, code: customer.code },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  // The same phone on another customer is a warning for the form, not a refusal.
  return { ok: true as const, customer, samePhone: await samePhone(input.organizationId, "CUSTOMER", customer.phone, customer.id) };
}

/** The fields P10 added, checked: a Bangladeshi phone, the district (and upazila of it), tags, payment days. */
async function detailsOf(db: Prisma.TransactionClient | typeof prisma, input: { phone?: string | null; altPhone?: string | null; businessName?: string | null; nid?: string | null; districtId?: number | null; upazilaId?: number | null; tags?: string | null; smsOptOut?: boolean; paymentDays?: number | null }, required: boolean) {
  const nid = input.nid?.trim() || null;
  if (nid && !/^\d{10}(\d{3}|\d{7})?$/.test(nid)) {
    throw new RuleError("A national ID number has 10, 13 or 17 digits.");
  }
  return {
    phone: phoneOf(input.phone),
    altPhone: phoneOf(input.altPhone, "other phone number"),
    businessName: input.businessName?.trim().slice(0, 191) || null,
    nid,
    ...(await placeOf(db, input, required)),
    tags: tagsOf(input.tags),
    smsOptOut: input.smsOptOut ?? false,
    paymentDays: paymentDaysOf(input.paymentDays),
  };
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
  businessName?: string | null;
  altPhone?: string | null;
  nid?: string | null;
  districtId?: number | null;
  upazilaId?: number | null;
  tags?: string | null;
  smsOptOut?: boolean;
  paymentDays?: number | null;
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
  let details: Awaited<ReturnType<typeof detailsOf>>;
  try {
    details = await detailsOf(prisma, input, false);
  } catch (error) {
    if (error instanceof RuleError) {
      return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: error.message };
    }
    throw error;
  }
  const customer = await prisma.customer.update({
    where: { id: current.id },
    data: {
      name,
      ...details,
      email: input.email?.trim().toLowerCase() || null,
      address: input.address?.trim() || null,
      customerTypeId: type.customerTypeId,
      creditLimit,
      paymentTerms: input.paymentTerms?.trim() || null,
      status: input.status,
      updatedById: input.actorId,
    },
    select: { id: true, name: true, code: true, phone: true },
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
  return { ok: true as const, customer, samePhone: await samePhone(input.organizationId, "CUSTOMER", customer.phone, customer.id) };
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
