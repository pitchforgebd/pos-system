import { Prisma } from "@prisma/client";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { decimalString, parseMoney } from "@/modules/inventory/money";

export function rejectLoyaltyPost() {
  return {
    ok: false as const,
    status: 422 as const,
    code: "BUSINESS_RULE" as const,
    message: "Earn, redeem, expiry, adjustment, and reversal amounts are not defined.",
  };
}

export async function listLoyaltyTiers(organizationId: string) {
  const rows = await prisma.loyaltyTier.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    minimumSpend: decimalString(row.minimumSpend, 2),
    discountPercent: decimalString(row.discountPercent, 2),
    benefits: row.benefits,
    status: row.status,
  }));
}

export async function createLoyaltyTier(input: {
  organizationId: string;
  actorId: string;
  name: string;
  minimumSpend: string;
  discountPercent: string;
  benefits?: string | null;
  ip: string;
  userAgent: string | null;
}) {
  const name = input.name.trim();
  const minimumSpend = parseMoney(input.minimumSpend);
  const discountPercent = parseMoney(input.discountPercent);
  if (!name || !minimumSpend || !discountPercent) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a tier name and amounts with up to two decimals." };
  }
  const tier = await prisma.loyaltyTier.create({
    data: {
      organizationId: input.organizationId,
      name,
      minimumSpend,
      discountPercent,
      benefits: input.benefits?.trim() || null,
    },
    select: { id: true, name: true },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "create",
    module: "loyalty",
    entityType: "loyalty_tier",
    entityId: tier.id,
    after: { name: tier.name },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, tier };
}

export async function listLoyaltyCards(organizationId: string) {
  const rows = await prisma.loyaltyCard.findMany({
    where: { organizationId },
    orderBy: { issuedOn: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      cardType: true,
      status: true,
      issuedOn: true,
      expiresOn: true,
      customer: { select: { name: true } },
      tier: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    cardType: row.cardType,
    status: row.status,
    issuedOn: dateOnly(row.issuedOn),
    expiresOn: row.expiresOn ? dateOnly(row.expiresOn) : null,
    customerName: row.customer.name,
    tierName: row.tier?.name ?? null,
  }));
}

export async function createLoyaltyCard(input: {
  organizationId: string;
  actorId: string;
  customerId: string;
  tierId?: string | null;
  number: string;
  cardType: string;
  issuedOn: string;
  expiresOn?: string | null;
  ip: string;
  userAgent: string | null;
}) {
  const number = input.number.trim();
  const cardType = input.cardType.trim();
  if (!number || !cardType) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a card number and a card type." };
  }
  if (input.expiresOn && input.expiresOn < input.issuedOn) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "The expiry date is before the issue date." };
  }
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!customer) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Choose an active customer." };
  }
  if (input.tierId) {
    const tier = await prisma.loyaltyTier.findFirst({
      where: { id: input.tierId, organizationId: input.organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!tier) {
      return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Choose an active tier." };
    }
  }
  try {
    const card = await prisma.loyaltyCard.create({
      data: {
        organizationId: input.organizationId,
        customerId: input.customerId,
        tierId: input.tierId || null,
        number,
        cardType,
        issuedOn: new Date(`${input.issuedOn}T00:00:00.000Z`),
        expiresOn: input.expiresOn ? new Date(`${input.expiresOn}T00:00:00.000Z`) : null,
      },
      select: { id: true, number: true },
    });
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.actorId,
      action: "create",
      module: "loyalty",
      entityType: "loyalty_card",
      entityId: card.id,
      after: { number: card.number },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true as const, card };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: "That card number is already used." };
    }
    throw error;
  }
}

export async function listLoyaltyTransactions(organizationId: string) {
  const rows = await prisma.loyaltyTransaction.findMany({
    where: { organizationId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: {
      id: true,
      entryType: true,
      points: true,
      businessDate: true,
      customer: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    businessDate: dateOnly(row.businessDate),
    customerName: row.customer.name,
    entryType: row.entryType,
    points: decimalString(row.points, 4),
  }));
}
