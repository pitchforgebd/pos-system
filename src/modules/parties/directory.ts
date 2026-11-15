import { Prisma } from "@prisma/client";

import { partyBalances } from "@/core/parties";
import { decimalString } from "@/core/money";
import { prisma } from "@/lib/db/client";
import { geography } from "@/modules/parties/profile";

// Finding a customer or a vendor (P10 task 4): part of the name, phone, other phone, code or business name; filtered by district, type and whether
// they owe (or are owed); a page at a time. What someone owes comes from the books, never from a stored figure.

export type DirectoryFilter = {
  q?: string;
  districtId?: number | null;
  customerTypeId?: string | null;
  /** YES: owes something (a customer) or is owed something (a vendor); NO: nothing. */
  due?: "YES" | "NO" | null;
  status?: "ACTIVE" | "INACTIVE" | null;
  page?: number;
  pageSize?: number;
};

const ZERO = new Prisma.Decimal(0);

/** The parties with an open balance on the receivable (customers) or the payable (vendors), from the journal. */
async function partiesWithBalance(organizationId: string, kind: "CUSTOMER" | "VENDOR") {
  const role = kind === "CUSTOMER" ? "AR" : "AP";
  const sign = kind === "CUSTOMER" ? Prisma.sql`SUM(l.debit - l.credit)` : Prisma.sql`SUM(l.credit - l.debit)`;
  const rows = await prisma.$queryRaw<Array<{ partyId: string }>>`
    SELECT l.partyId AS partyId
    FROM journal_lines l
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role = ${role}
    WHERE l.organizationId = ${organizationId} AND l.partyType = ${kind} AND l.partyId IS NOT NULL
    GROUP BY l.partyId
    HAVING ${sign} > 0.004
  `;
  return rows.map((row) => row.partyId);
}

function textFilter(q: string | undefined, fields: string[]) {
  const needle = q?.trim();
  if (!needle) {
    return {};
  }
  return { OR: fields.map((field) => ({ [field]: { contains: needle } })) };
}

const paging = (filter: DirectoryFilter) => {
  const pageSize = [25, 50, 100, 200].includes(filter.pageSize ?? 0) ? (filter.pageSize as number) : 50;
  const page = Number.isInteger(filter.page) && (filter.page as number) > 0 ? (filter.page as number) : 1;
  return { page, pageSize };
};

async function districtNames() {
  const geo = await geography();
  return new Map(geo.districts.map((district) => [district.id, district.name]));
}

export async function findCustomers(organizationId: string, filter: DirectoryFilter = {}) {
  const { page, pageSize } = paging(filter);
  const owing = filter.due ? await partiesWithBalance(organizationId, "CUSTOMER") : [];
  const where: Prisma.CustomerWhereInput = {
    organizationId,
    isSystem: false,
    ...textFilter(filter.q, ["name", "phone", "altPhone", "code", "businessName"]),
    ...(filter.districtId ? { districtId: filter.districtId } : {}),
    ...(filter.customerTypeId ? { customerTypeId: filter.customerTypeId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.due === "YES" ? { id: { in: owing } } : filter.due === "NO" ? { id: { notIn: owing } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, code: true, name: true, businessName: true, phone: true, districtId: true, status: true, smsOptOut: true, customerType: { select: { name: true } } },
    }),
  ]);
  const [balances, districts] = await Promise.all([partyBalances(prisma, { organizationId, partyType: "CUSTOMER", partyIds: rows.map((row) => row.id) }), districtNames()]);
  return {
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      businessName: row.businessName,
      phone: row.phone,
      district: row.districtId ? (districts.get(row.districtId) ?? null) : null,
      type: row.customerType?.name ?? null,
      status: row.status,
      smsOptOut: row.smsOptOut,
      due: decimalString(balances.get(row.id)?.balance ?? ZERO, 2),
      advance: decimalString(balances.get(row.id)?.advance ?? ZERO, 2),
    })),
  };
}

export async function findVendors(organizationId: string, filter: DirectoryFilter = {}) {
  const { page, pageSize } = paging(filter);
  const owed = filter.due ? await partiesWithBalance(organizationId, "VENDOR") : [];
  const where: Prisma.SupplierWhereInput = {
    organizationId,
    ...textFilter(filter.q, ["name", "phone", "altPhone", "code", "contactPerson"]),
    ...(filter.districtId ? { districtId: filter.districtId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.due === "YES" ? { id: { in: owed } } : filter.due === "NO" ? { id: { notIn: owed } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, code: true, name: true, contactPerson: true, phone: true, districtId: true, status: true } }),
  ]);
  const [balances, districts] = await Promise.all([partyBalances(prisma, { organizationId, partyType: "VENDOR", partyIds: rows.map((row) => row.id) }), districtNames()]);
  return {
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      contactPerson: row.contactPerson,
      phone: row.phone,
      district: row.districtId ? (districts.get(row.districtId) ?? null) : null,
      status: row.status,
      // A vendor's balance is what the shop owes them.
      owed: decimalString(balances.get(row.id)?.balance ?? ZERO, 2),
    })),
  };
}
