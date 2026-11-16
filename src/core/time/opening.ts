import type { Prisma, PrismaClient } from "@prisma/client";

import { businessDate, dateOnly } from "@/core/time/business-date";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The date an opening balance is posted on: the day the owner says the books start (organizations.booksStartOn), or today when that is not
 * set. Found by the 7-day user test: with every opening dated the day it was typed, a shop that started its books a week earlier showed its
 * cash below zero on every day before.
 */
export async function openingDate(db: Db, organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { booksStartOn: true } });
  return org?.booksStartOn ? dateOnly(org.booksStartOn) : businessDate();
}
