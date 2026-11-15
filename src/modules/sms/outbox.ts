import type { Prisma, SmsTemplateKind } from "@prisma/client";

import { registerDrain, requestDrain } from "@/core/outbox/drain";
import { prisma } from "@/lib/db/client";
import { normalizeBdPhone } from "@/modules/parties/profile";
import { smsParts } from "@/modules/sms/parts";
import { currentProvider } from "@/modules/sms/provider";
import { renderTemplate } from "@/modules/sms/templates";

// The SMS outbox (P10 task 6, B12, B13). A message is written as QUEUED in the same transaction as what it is about (a sale, a receipt, a campaign),
// so it exists only if that committed; it is sent afterwards. Sending claims the row first (QUEUED -> SENDING by a conditional update), so two
// drains never send one message twice. A failure is tried again after 1, 2 and 4 minutes; after the fourth try it is FAILED (it can be retried by
// hand). Money never waits for an SMS and is never undone by one.

type Db = Prisma.TransactionClient | typeof prisma;

/** The first try and three more. */
export const MAX_ATTEMPTS = 4;
const BACKOFF_MINUTES = [1, 2, 4];

export type Queued = { id: string; parts: number };

/** Puts a message in the outbox. Null when the number is not a Bangladeshi mobile number (nothing is queued). */
export async function enqueueSms(
  db: Db,
  input: { organizationId: string; to: string | null | undefined; body: string; templateId?: string | null; customerId?: string | null; campaignId?: string | null },
): Promise<Queued | null> {
  const to = normalizeBdPhone(input.to);
  const body = input.body.trim();
  if (!to || !body) {
    return null;
  }
  const parts = smsParts(body).parts;
  const row = await db.smsMessage.create({
    data: { organizationId: input.organizationId, recipient: to, body, status: "QUEUED", segments: parts, templateId: input.templateId ?? null, customerId: input.customerId ?? null, campaignId: input.campaignId ?? null, nextAttemptAt: new Date() },
    select: { id: true },
  });
  requestDrain();
  return { id: row.id, parts };
}

/**
 * A notice about something the customer did (a sale, a payment, an order), from the shop's active template of that kind. Nothing is queued when the
 * shop has no such template, the customer is Walk-in or has no mobile number. Called inside the document's transaction.
 */
export async function queueNotice(tx: Prisma.TransactionClient, input: { organizationId: string; kind: SmsTemplateKind; customerId: string | null | undefined; values: Record<string, string> }) {
  if (!input.customerId) {
    return null;
  }
  const template = await tx.smsTemplate.findFirst({ where: { organizationId: input.organizationId, kind: input.kind, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, select: { id: true, body: true } });
  if (!template) {
    return null;
  }
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, organizationId: input.organizationId }, select: { name: true, phone: true, isSystem: true, district: { select: { name: true } } } });
  if (!customer || customer.isSystem || !customer.phone) {
    return null;
  }
  const shop = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } });
  const rendered = renderTemplate(template.body, { customer_name: customer.name, shop_name: shop?.name ?? "", district: customer.district?.name ?? "", ...input.values });
  if (!rendered.ok) {
    return null;
  }
  return enqueueSms(tx, { organizationId: input.organizationId, to: customer.phone, body: rendered.body, templateId: template.id, customerId: input.customerId });
}

export type DrainResult = { configured: boolean; sent: number; retrying: number; failed: number };

/**
 * Sends what is due in the outbox, oldest first (never inside a transaction). Without a provider nothing is touched: the messages wait.
 * `ids` limits it to some messages (sending one now from the send form).
 */
export async function drainOutbox(input: { organizationId?: string; ids?: string[]; limit?: number } = {}): Promise<DrainResult> {
  const provider = currentProvider();
  const result: DrainResult = { configured: provider !== null, sent: 0, retrying: 0, failed: 0 };
  if (!provider) {
    return result;
  }
  const now = new Date();
  const due = await prisma.smsMessage.findMany({
    where: {
      status: "QUEUED",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input.ids ? { id: { in: input.ids } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(input.limit ?? 50, 1), 500),
    select: { id: true, organizationId: true, recipient: true, body: true, attempts: true },
  });
  for (const message of due) {
    // Claim it: only the drain that moves it from QUEUED sends it.
    const claimed = await prisma.smsMessage.updateMany({ where: { id: message.id, status: "QUEUED" }, data: { status: "SENDING" } });
    if (claimed.count !== 1) {
      continue;
    }
    const attempt = message.attempts + 1;
    const outcome = await provider.send(message.recipient, message.body);
    if (outcome.ok) {
      await prisma.smsMessage.update({ where: { id: message.id }, data: { status: "SENT", attempts: attempt, sentAt: new Date(), providerRef: outcome.ref, lastError: null, nextAttemptAt: null } });
      await prisma.smsLog.create({ data: { organizationId: message.organizationId, messageId: message.id, result: `${provider.name}: ${outcome.note}`.slice(0, 255) } });
      result.sent += 1;
      continue;
    }
    const last = attempt >= MAX_ATTEMPTS;
    await prisma.smsMessage.update({
      where: { id: message.id },
      data: { status: last ? "FAILED" : "QUEUED", attempts: attempt, lastError: outcome.error.slice(0, 255), nextAttemptAt: last ? null : new Date(Date.now() + BACKOFF_MINUTES[attempt - 1] * 60_000) },
    });
    await prisma.smsLog.create({ data: { organizationId: message.organizationId, messageId: message.id, result: `${provider.name}: ${outcome.error}`.slice(0, 255) } });
    if (last) {
      result.failed += 1;
    } else {
      result.retrying += 1;
    }
  }
  return result;
}

/** A failed message goes back in the outbox for another round of tries. */
export async function requeueFailed(organizationId: string, id: string) {
  const changed = await prisma.smsMessage.updateMany({ where: { id, organizationId, status: "FAILED" }, data: { status: "QUEUED", attempts: 0, nextAttemptAt: new Date() } });
  if (changed.count === 1) {
    requestDrain();
  }
  return changed.count === 1;
}

/** How many messages wait, are being sent, were sent and failed. */
export async function outboxCounts(organizationId: string) {
  const rows = await prisma.smsMessage.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true }, _sum: { segments: true } });
  const of = (status: string) => rows.find((row) => row.status === status);
  return {
    queued: of("QUEUED")?._count._all ?? 0,
    sending: of("SENDING")?._count._all ?? 0,
    sent: of("SENT")?._count._all ?? 0,
    failed: of("FAILED")?._count._all ?? 0,
    sentParts: of("SENT")?._sum.segments ?? 0,
  };
}

registerDrain(() => drainOutbox());
