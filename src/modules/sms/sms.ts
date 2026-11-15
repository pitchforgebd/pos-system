import { runTx } from "@/core/tx/run";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { hashPayload, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { decimalString, money, parseMoney, parseQuantity } from "@/core/money";
import { StockRuleError } from "@/modules/inventory/stock";
import { drainOutbox, enqueueSms, outboxCounts, requeueFailed } from "@/modules/sms/outbox";
import { smsParts } from "@/modules/sms/parts";
import { currentProvider } from "@/modules/sms/provider";
import { renderTemplate, validateTemplateBody } from "@/modules/sms/templates";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

const senderKey = "sms.sender";
const providerKey = "sms.provider";
const priceKey = "sms.unitPrice";

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const code = error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return { ok: false, status: error.status, code, message: error.message };
  }
  return null;
}

function utcStart(part: "day" | "month" | "year") {
  const now = new Date();
  if (part === "day") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (part === "month") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

async function setting(organizationId: string, key: string) {
  const row = await prisma.setting.findUnique({ where: { organizationId_key: { organizationId, key } } });
  return row?.value ?? null;
}

export async function getSmsSettings(organizationId: string) {
  const [sender, provider, unitPrice] = await Promise.all([
    setting(organizationId, senderKey),
    setting(organizationId, providerKey),
    setting(organizationId, priceKey),
  ]);
  return { sender, provider, unitPrice };
}

export async function saveSmsSettings(input: {
  organizationId: string;
  actorId: string;
  sender: string;
  provider?: string | null;
  unitPrice?: string | null;
  ip: string;
  userAgent: string | null;
}) {
  const sender = input.sender.trim();
  if (!sender || sender.length > 64) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a sender name of up to 64 characters." };
  }
  const provider = input.provider?.trim() || null;
  if (provider && provider.length > 64) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a provider label of up to 64 characters." };
  }
  let unitPrice: string | null | undefined;
  if (input.unitPrice !== undefined) {
    if (!input.unitPrice) {
      unitPrice = null;
    } else {
      const parsed = parseMoney(input.unitPrice);
      if (!parsed) {
        return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a per-SMS price with up to two decimals." };
      }
      unitPrice = decimalString(parsed, 2);
    }
  }
  const settings: { key: string; value: string | null }[] = [
    { key: senderKey, value: sender },
    { key: providerKey, value: provider },
  ];
  if (unitPrice !== undefined) {
    settings.push({ key: priceKey, value: unitPrice });
  }
  await runTx(async (tx) => {
    for (const setting of settings) {
      await tx.setting.upsert({
        where: { organizationId_key: { organizationId: input.organizationId, key: setting.key } },
        update: { value: setting.value },
        create: { organizationId: input.organizationId, key: setting.key, value: setting.value },
      });
    }
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "settings",
    module: "sms",
    entityType: "sms_settings",
    entityId: input.organizationId,
    after: { sender, provider, unitPrice },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const };
}

export async function listTemplates(organizationId: string) {
  const rows = await prisma.smsTemplate.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    take: 100,
  });
  return rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, body: row.body, status: row.status }));
}

export async function createTemplate(input: {
  organizationId: string;
  actorId: string;
  name: string;
  kind: "BILL" | "DUE_COLLECTION" | "DUE_REMINDER" | "ORDER_STATUS" | "OFFER";
  body: string;
  ip: string;
  userAgent: string | null;
}) {
  const name = input.name.trim();
  const invalid = validateTemplateBody(input.body);
  if (!name || invalid) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: invalid ?? "Enter a template name." };
  }
  const template = await prisma.smsTemplate.create({
    data: { organizationId: input.organizationId, name, kind: input.kind, body: input.body.trim() },
    select: { id: true, name: true },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "create",
    module: "sms",
    entityType: "sms_template",
    entityId: template.id,
    after: { name: template.name },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, template };
}

/**
 * One message from the send form: written to the outbox (QUEUED) in the request's transaction and sent right after it (the outbox drain). A number
 * that is not a Bangladeshi mobile number is refused.
 */
export async function sendSms(input: {
  organizationId: string;
  userId: string;
  idempotencyKey: string;
  recipient: string;
  templateId?: string | null;
  body?: string | null;
  variables?: Record<string, string>;
  ip: string;
  userAgent: string | null;
}) {
  const variables = input.variables ?? {};
  const requestHash = hashPayload({ recipient: input.recipient.trim(), templateId: input.templateId ?? null, body: input.body ?? null, variables });
  try {
    const prepared = await runTx(async (tx) => {
      const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        return { id: existing.entityId, replayed: true as const };
      }
      let source = input.body?.trim() ?? "";
      let templateId: string | null = null;
      if (input.templateId) {
        const template = await tx.smsTemplate.findFirst({ where: { id: input.templateId, organizationId: input.organizationId, status: "ACTIVE" }, select: { id: true, body: true } });
        if (!template) {
          throw new StockRuleError("Choose an active template.");
        }
        source = template.body;
        templateId = template.id;
      }
      const invalid = validateTemplateBody(source);
      if (invalid) {
        throw new StockRuleError(invalid);
      }
      const rendered = renderTemplate(source, variables);
      if (!rendered.ok) {
        throw new StockRuleError(rendered.message);
      }
      const queued = await enqueueSms(tx, { organizationId: input.organizationId, to: input.recipient, body: rendered.body, templateId });
      if (!queued) {
        throw new StockRuleError("Enter the number as a Bangladeshi mobile number (01XXXXXXXXX).");
      }
      await saveIdempotency(tx, { organizationId: input.organizationId, userId: input.userId, key: input.idempotencyKey, requestHash, entityType: "sms_message", entityId: queued.id });
      return { id: queued.id, replayed: false as const, parts: queued.parts };
    });
    const stored = await prisma.smsMessage.findFirst({ where: { id: prepared.id }, select: { status: true, segments: true } });
    return { ok: true as const, id: prepared.id, status: stored?.status ?? "QUEUED", parts: stored?.segments ?? 1, replayed: prepared.replayed };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/** A failed message goes back to the outbox for another round of tries; a sent one is never sent again. */
export async function retrySms(input: { organizationId: string; userId: string; messageId: string; idempotencyKey: string }) {
  const message = await prisma.smsMessage.findFirst({ where: { id: input.messageId, organizationId: input.organizationId }, select: { id: true, status: true } });
  if (!message) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  if (message.status === "SENT") {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "A sent message is not sent again." };
  }
  if (message.status !== "FAILED") {
    return { ok: true as const, id: message.id, status: message.status, replayed: true };
  }
  await requeueFailed(input.organizationId, message.id);
  return { ok: true as const, id: message.id, status: "QUEUED", replayed: false };
}

export async function listMessages(organizationId: string) {
  const rows = await prisma.smsMessage.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, recipient: true, body: true, status: true, createdAt: true, sentAt: true, segments: true, attempts: true, lastError: true, campaign: { select: { name: true } }, logs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return rows.map((row) => ({
    id: row.id,
    recipient: row.recipient,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    parts: row.segments,
    attempts: row.attempts,
    campaign: row.campaign?.name ?? null,
    result: row.lastError ?? row.logs[0]?.result ?? "",
  }));
}

export async function listNotificationLogs(organizationId: string) {
  const rows = await prisma.notificationLog.findMany({
    where: { organizationId, channel: "SMS" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    recipient: row.recipient,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function requestRecharge(input: {
  organizationId: string;
  actorId: string;
  idempotencyKey: string;
  quantity: string;
  businessDate: string;
  ip: string;
  userAgent: string | null;
}) {
  const quantity = parseQuantity(input.quantity);
  const priceText = await setting(input.organizationId, priceKey);
  const price = priceText ? parseMoney(priceText) : null;
  if (!quantity) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter an SMS quantity greater than zero." };
  }
  if (!price) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Set a per-SMS price before requesting a recharge." };
  }
  const amount = money(quantity.times(price));
  const requestHash = hashPayload({ quantity: decimalString(quantity, 4), businessDate: input.businessDate });
  try {
    const created = await runTx(async (tx) => {
      const existing = await readIdempotency(tx, { organizationId: input.organizationId, key: input.idempotencyKey, requestHash });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        const stored = await tx.smsRechargeRequest.findFirst({ where: { id: existing.entityId }, select: { id: true, amount: true } });
        return { id: stored?.id ?? existing.entityId, amount: stored ? decimalString(stored.amount, 2) : decimalString(amount, 2), replayed: true as const };
      }
      const request = await tx.smsRechargeRequest.create({
        data: {
          organizationId: input.organizationId,
          quantity,
          amount,
          status: "REQUESTED",
          requestedOn: new Date(`${input.businessDate}T00:00:00.000Z`),
        },
        select: { id: true, amount: true },
      });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.actorId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "sms_recharge",
        entityId: request.id,
      });
      return { id: request.id, amount: decimalString(request.amount, 2), replayed: false as const };
    });
    if (!created.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        userId: input.actorId,
        action: "recharge",
        module: "sms",
        entityType: "sms_recharge",
        entityId: created.id,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    return { ok: true as const, id: created.id, amount: created.amount, replayed: created.replayed };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function listRecharges(organizationId: string) {
  const rows = await prisma.smsRechargeRequest.findMany({
    where: { organizationId },
    orderBy: { requestedOn: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    quantity: decimalString(row.quantity, 4),
    amount: decimalString(row.amount, 2),
    status: row.status,
    requestedOn: dateOnly(row.requestedOn),
  }));
}

/**
 * The SMS figures: what the outbox holds, what was sent today/this month/this year, and what the provider says is left on the account (the old
 * "balance" worked out from recharge requests is gone: only the provider knows it).
 */
export async function smsDashboard(organizationId: string) {
  const provider = currentProvider();
  const [settings, purchase, sentToday, sentMonth, sentYear, outbox, balance] = await Promise.all([
    getSmsSettings(organizationId),
    prisma.smsRechargeRequest.aggregate({ where: { organizationId }, _sum: { amount: true, quantity: true } }),
    prisma.smsMessage.count({ where: { organizationId, status: "SENT", sentAt: { gte: utcStart("day") } } }),
    prisma.smsMessage.count({ where: { organizationId, status: "SENT", sentAt: { gte: utcStart("month") } } }),
    prisma.smsMessage.count({ where: { organizationId, status: "SENT", sentAt: { gte: utcStart("year") } } }),
    outboxCounts(organizationId),
    provider?.balance ? provider.balance().catch(() => null) : Promise.resolve(null),
  ]);
  return {
    provider: provider?.name ?? null,
    quantity: decimalString(purchase._sum.quantity ?? 0, 4),
    unitPrice: settings.unitPrice,
    totalPurchase: decimalString(purchase._sum.amount ?? 0, 2),
    sentToday,
    sentMonth,
    sentYear,
    sentTotal: outbox.sent,
    sentParts: outbox.sentParts,
    queued: outbox.queued + outbox.sending,
    failed: outbox.failed,
    /** What the provider says is left; null when it cannot say. */
    balance,
  };
}

/** Sends what waits in the outbox now (the button on the SMS page; a cron job can call the same). */
export async function sendWaiting(organizationId: string) {
  return drainOutbox({ organizationId, limit: 200 });
}

/** The parts and the cost of a message before it is sent. */
export async function estimate(organizationId: string, body: string, recipients: number) {
  const parts = smsParts(body);
  const priceText = await setting(organizationId, priceKey);
  const price = priceText ? parseMoney(priceText) : null;
  return { ...parts, recipients, totalParts: parts.parts * recipients, cost: price ? decimalString(money(price.times(parts.parts * recipients)), 2) : null };
}

