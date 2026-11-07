import { prisma } from "@/lib/db/client";
import { businessDate } from "@/core/time/business-date";
import { decimalString } from "@/modules/inventory/money";

export async function listHandovers(organizationId: string, branchId: string) {
  const rows = await prisma.cashHandover.findMany({
    where: { organizationId, shift: { branchId } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      amount: true,
      createdAt: true,
      fromUser: { select: { name: true } },
      toUser: { select: { name: true } },
      shift: { select: { id: true, status: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    fromName: row.fromUser.name,
    toName: row.toUser.name,
    amount: decimalString(row.amount, 2),
    createdOn: businessDate(row.createdAt),
    shiftId: row.shift.id,
    status: row.shift.status,
  }));
}
