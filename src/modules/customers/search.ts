import { Prisma } from "@prisma/client";

import { partyBalances } from "@/core/parties";
import { decimalString } from "@/core/money";
import { prisma } from "@/lib/db/client";

const LIMIT = 20;

export type CustomerHit = {
  id: string;
  name: string;
  phone: string | null;
  customerTypeId: string | null;
  customerTypeName: string | null;
  /** The price level this customer's type buys at (null: the default level). */
  priceLevelId: string | null;
  /** What they owe, and the advance held for them, from the books (only for the rows returned). */
  outstanding: string;
  advance: string;
};

/** Customers by name or phone, 20 at a time, with the balance of those rows only (H8). */
export async function searchCustomers(input: { organizationId: string; q: string }): Promise<CustomerHit[]> {
  const q = input.q.trim();
  if (q === "") {
    return [];
  }
  const rows = await prisma.customer.findMany({
    where: { organizationId: input.organizationId, status: "ACTIVE", OR: [{ name: { contains: q } }, { phone: { contains: q } }] },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: LIMIT,
    select: { id: true, name: true, phone: true, customerType: { select: { id: true, name: true, priceLevelId: true } } },
  });
  const balances = await partyBalances(prisma, { organizationId: input.organizationId, partyType: "CUSTOMER", partyIds: rows.map((row) => row.id) });
  const zero = new Prisma.Decimal(0);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    customerTypeId: row.customerType?.id ?? null,
    customerTypeName: row.customerType?.name ?? null,
    priceLevelId: row.customerType?.priceLevelId ?? null,
    outstanding: decimalString(balances.get(row.id)?.balance ?? zero, 2),
    advance: decimalString(balances.get(row.id)?.advance ?? zero, 2),
  }));
}
