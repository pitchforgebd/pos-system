import { Prisma, type SmsCampaignField } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { hashPayload } from "@/core/idempotency";
import { decimalString } from "@/core/money";
import { partyBalances } from "@/core/parties";
import { paymentStatuses } from "@/core/payments";
import { addDays, businessDate as today, dateOnly, isIsoDate } from "@/core/time/business-date";
import { runTx } from "@/core/tx/run";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { normalizeBdPhone } from "@/modules/parties/profile";
import { failure } from "@/modules/purchasing/common";
import { enqueueSms } from "@/modules/sms/outbox";
import { smsParts } from "@/modules/sms/parts";
import { remember, replay } from "@/modules/treasury/common";
import { renderTemplate, validateTemplateBody } from "@/modules/sms/templates";

// Offer campaigns and due reminders (P10 tasks 8-9, features 4 and 15). A segment is a set of filters: the same field more than once is "any of"
// (Dhaka or Gazipur), different fields must all hold (Dhaka and owes something). Who opted out of offer SMS, Walk-in, an inactive customer and a
// customer with no mobile number are never in it. Sending writes one message per customer to the outbox, in one transaction with the campaign.

export type Filter = { field: SmsCampaignField; value: string };

const ZERO = new Prisma.Decimal(0);
const MAX_RECIPIENTS = 5000;

function valuesOf(filters: Filter[], field: SmsCampaignField) {
  return filters.filter((filter) => filter.field === field).map((filter) => filter.value.trim()).filter(Boolean);
}

function one(filters: Filter[], field: SmsCampaignField) {
  const values = valuesOf(filters, field);
  if (values.length > 1) {
    throw new RuleError("Give that filter once.");
  }
  return values[0] ?? null;
}

function dateValue(text: string | null) {
  if (text !== null && !isIsoDate(text)) {
    throw new RuleError("A date filter needs a date (YYYY-MM-DD).");
  }
  return text;
}

function moneyValue(text: string | null) {
  if (text === null) {
    return null;
  }
  if (!/^\d{1,14}(\.\d{1,2})?$/.test(text)) {
    throw new RuleError("An amount filter needs an amount.");
  }
  return new Prisma.Decimal(text);
}

/** Customers with what they bought in all (posted sales) and when last. */
async function purchases(organizationId: string) {
  const rows = await prisma.sale.groupBy({ by: ["customerId"], where: { organizationId, status: "POSTED", customerId: { not: null } }, _sum: { total: true }, _max: { businessDate: true } });
  return new Map(rows.map((row) => [row.customerId as string, { total: new Prisma.Decimal(row._sum.total ?? 0), last: row._max.businessDate ? dateOnly(row._max.businessDate) : null }]));
}

/** Customers who owe something, and whether an unpaid invoice of theirs is older than allowed (N days, or each customer's own days to pay). */
async function owing(organizationId: string, olderThan: string | null) {
  const customers = await prisma.customer.findMany({ where: { organizationId, isSystem: false }, select: { id: true, paymentDays: true } });
  const balances = await partyBalances(prisma, { organizationId, partyType: "CUSTOMER", partyIds: customers.map((row) => row.id) });
  const owes = customers.filter((row) => (balances.get(row.id)?.balance ?? ZERO).gt(0));
  const due = new Map(owes.map((row) => [row.id, balances.get(row.id)?.balance ?? ZERO]));
  if (olderThan === null) {
    return { ids: new Set(owes.map((row) => row.id)), due };
  }
  const days = olderThan === "TERMS" ? null : Number(olderThan);
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) {
    throw new RuleError("The days overdue are a whole number, or the customer's own days to pay.");
  }
  const late = new Set<string>();
  for (const customer of owes) {
    const cutoff = addDays(today(), -(days ?? customer.paymentDays ?? 0));
    const sales = await prisma.sale.findMany({ where: { organizationId, customerId: customer.id, status: "POSTED", businessDate: { lt: new Date(`${cutoff}T00:00:00.000Z`) } }, select: { id: true, total: true } });
    const status = await paymentStatuses(prisma, organizationId, "CUSTOMER", sales);
    if ([...status.values()].some((row) => row.owed.gt(0))) {
      late.add(customer.id);
    }
  }
  return { ids: late, due };
}

/** The customers a segment reaches, with what each owes (for a reminder). */
export async function segment(organizationId: string, filters: Filter[]) {
  const districts = valuesOf(filters, "DISTRICT").map(Number);
  if (districts.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new RuleError("Choose the district from the list.");
  }
  const types = valuesOf(filters, "CUSTOMER_TYPE");
  const before = dateValue(one(filters, "LAST_PURCHASE_BEFORE"));
  const after = dateValue(one(filters, "LAST_PURCHASE_AFTER"));
  const min = moneyValue(one(filters, "TOTAL_PURCHASE_MIN"));
  const max = moneyValue(one(filters, "TOTAL_PURCHASE_MAX"));
  const hasDue = one(filters, "HAS_DUE");
  if (hasDue !== null && hasDue !== "YES" && hasDue !== "NO") {
    throw new RuleError("Owes something is yes or no.");
  }
  const olderThan = one(filters, "DUE_OLDER_THAN_DAYS");
  const products = valuesOf(filters, "BOUGHT_PRODUCT");
  const categories = valuesOf(filters, "BOUGHT_CATEGORY");

  const candidates = await prisma.customer.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      isSystem: false,
      smsOptOut: false,
      phone: { not: null },
      ...(districts.length > 0 ? { districtId: { in: districts } } : {}),
      ...(types.length > 0 ? { customerTypeId: { in: types } } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, phone: true, district: { select: { name: true } } },
  });
  let rows = candidates.filter((row) => normalizeBdPhone(row.phone) !== null);

  if (before || after || min || max) {
    const bought = await purchases(organizationId);
    rows = rows.filter((row) => {
      const mine = bought.get(row.id);
      const total = mine?.total ?? ZERO;
      if (before && !(mine?.last && mine.last < before)) return false;
      if (after && !(mine?.last && mine.last >= after)) return false;
      if (min && total.lt(min)) return false;
      if (max && total.gt(max)) return false;
      return true;
    });
  }
  let due = new Map<string, Prisma.Decimal>();
  if (hasDue !== null || olderThan !== null) {
    const found = await owing(organizationId, olderThan);
    due = found.due;
    rows = rows.filter((row) => (hasDue === "NO" ? !found.due.has(row.id) : found.ids.has(row.id)));
  }
  if (products.length > 0 || categories.length > 0) {
    const items = await prisma.saleItem.findMany({
      where: {
        sale: { organizationId, status: "POSTED", customerId: { in: rows.map((row) => row.id) } },
        OR: [...(products.length > 0 ? [{ productId: { in: products } }] : []), ...(categories.length > 0 ? [{ product: { categoryId: { in: categories } } }] : [])],
      },
      select: { sale: { select: { customerId: true } } },
    });
    const buyers = new Set(items.map((item) => item.sale.customerId));
    rows = rows.filter((row) => buyers.has(row.id));
  }
  return rows.map((row) => ({ id: row.id, name: row.name, phone: normalizeBdPhone(row.phone) as string, district: row.district?.name ?? "", due: due.get(row.id) ?? ZERO }));
}

type Message = { body: string; offerText?: string | null };

async function shopName(organizationId: string) {
  return (await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }))?.name ?? "";
}

function renderFor(message: Message, shop: string, row: { name: string; district: string; due: Prisma.Decimal }) {
  const due = decimalString(row.due, 2);
  const rendered = renderTemplate(message.body, { customer_name: row.name, district: row.district, offer_text: message.offerText?.trim() ?? "", shop_name: shop, due_amount: due, current_balance: due, previous_due: due });
  if (!rendered.ok) {
    throw new RuleError(rendered.message);
  }
  return rendered.body;
}

function checkMessage(message: Message) {
  const invalid = validateTemplateBody(message.body);
  if (invalid) {
    throw new RuleError(invalid);
  }
  if ((message.offerText ?? "").length > 500) {
    throw new RuleError("The offer text is too long (500 characters at most).");
  }
}

/** Who the campaign would reach, a few of the messages as they would read, and how many SMS parts and what it would cost. */
export async function previewCampaign(organizationId: string, input: Message & { filters: Filter[] }) {
  try {
    checkMessage(input);
    const rows = await segment(organizationId, input.filters);
    const shop = await shopName(organizationId);
    const bodies = rows.map((row) => renderFor(input, shop, row));
    const totalParts = bodies.reduce((sum, body) => sum + smsParts(body).parts, 0);
    const longest = bodies.reduce((best, body) => (body.length > best.length ? body : best), renderFor(input, shop, { name: "", district: "", due: ZERO }));
    const price = await unitPrice(organizationId);
    return {
      ok: true as const,
      recipients: rows.length,
      totalParts,
      partsEach: smsParts(longest),
      cost: price === null ? null : decimalString(price.mul(totalParts), 2),
      sample: rows.slice(0, 10).map((row, index) => ({ name: row.name, phone: row.phone, body: bodies[index] })),
      tooMany: rows.length > MAX_RECIPIENTS,
    };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

async function unitPrice(organizationId: string) {
  const row = await prisma.setting.findUnique({ where: { organizationId_key: { organizationId, key: "sms.unitPrice" } } });
  return row?.value && /^\d+(\.\d{1,2})?$/.test(row.value) ? new Prisma.Decimal(row.value) : null;
}

type Actor = { organizationId: string; branchId: string; userId: string; idempotencyKey: string; ip: string; userAgent: string | null };

/**
 * Sends a campaign (needs sms.campaign): the campaign, its filters and one outbox message per customer, in one transaction; they go out right after.
 * Opted-out customers are never in it.
 */
export async function sendCampaign(input: Actor & Message & { name: string; kind: "OFFER" | "DUE_REMINDER"; templateId?: string | null; filters: Filter[] }) {
  const requestHash = hashPayload({ name: input.name, kind: input.kind, body: input.body, offerText: input.offerText ?? "", filters: input.filters, templateId: input.templateId ?? null });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, recipients: 0, parts: 0, replayed: true };
      }
      const name = input.name.trim();
      if (!name || name.length > 191) {
        throw new RuleError("Give the campaign a name.");
      }
      checkMessage(input);
      if (input.templateId && !(await tx.smsTemplate.findFirst({ where: { id: input.templateId, organizationId: input.organizationId }, select: { id: true } }))) {
        throw new RuleError("That template is not one of the shop's.");
      }
      const rows = await segment(input.organizationId, input.filters);
      if (rows.length === 0) {
        throw new RuleError("No customer is in this segment.");
      }
      if (rows.length > MAX_RECIPIENTS) {
        throw new RuleError(`A campaign reaches at most ${MAX_RECIPIENTS} customers: narrow the segment.`);
      }
      const shop = await shopName(input.organizationId);
      const price = await unitPrice(input.organizationId);
      const campaign = await tx.smsCampaign.create({
        data: { organizationId: input.organizationId, name, kind: input.kind, templateId: input.templateId ?? null, body: input.body.trim(), offerText: input.offerText?.trim() || null, status: "DRAFT", createdById: input.userId },
        select: { id: true },
      });
      if (input.filters.length > 0) {
        await tx.smsCampaignFilter.createMany({ data: input.filters.map((filter) => ({ organizationId: input.organizationId, campaignId: campaign.id, field: filter.field, value: filter.value.trim().slice(0, 64) })) });
      }
      let parts = 0;
      for (const row of rows) {
        const queued = await enqueueSms(tx, { organizationId: input.organizationId, to: row.phone, body: renderFor(input, shop, row), templateId: input.templateId ?? null, customerId: row.id, campaignId: campaign.id });
        parts += queued?.parts ?? 0;
      }
      await tx.smsCampaign.update({ where: { id: campaign.id }, data: { status: "QUEUED", recipientCount: rows.length, segmentCount: parts, estimatedCost: price ? price.mul(parts) : null, queuedAt: new Date() } });
      await remember(tx, { ...input, requestHash, entityType: "sms_campaign", entityId: campaign.id });
      return { id: campaign.id, recipients: rows.length, parts, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "campaign", module: "sms", entityType: "sms_campaign", entityId: data.id, after: { name: input.name, kind: input.kind, recipients: data.recipients, parts: data.parts }, ip: input.ip, userAgent: input.userAgent });
    }
    return { ok: true as const, ...data };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/** The campaigns with how many of their messages were sent, wait, and failed. */
export async function listCampaigns(organizationId: string) {
  const rows = await prisma.smsCampaign.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100 });
  const counts = await prisma.smsMessage.groupBy({ by: ["campaignId", "status"], where: { organizationId, campaignId: { in: rows.map((row) => row.id) } }, _count: { _all: true } });
  const of = (id: string, statuses: string[]) => counts.filter((row) => row.campaignId === id && statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    recipients: row.recipientCount,
    parts: row.segmentCount,
    cost: row.estimatedCost ? decimalString(row.estimatedCost, 2) : null,
    sent: of(row.id, ["SENT"]),
    waiting: of(row.id, ["QUEUED", "SENDING"]),
    failed: of(row.id, ["FAILED"]),
    queuedAt: row.queuedAt ? row.queuedAt.toISOString() : null,
  }));
}

export async function getCampaign(organizationId: string, id: string) {
  const campaign = await prisma.smsCampaign.findFirst({ where: { id, organizationId }, include: { filters: true } });
  if (!campaign) {
    return null;
  }
  const messages = await prisma.smsMessage.findMany({ where: { organizationId, campaignId: id }, orderBy: { createdAt: "asc" }, take: 1000, select: { id: true, recipient: true, body: true, status: true, attempts: true, lastError: true, segments: true, customer: { select: { id: true, name: true } } } });
  const summary = (await listCampaigns(organizationId)).find((row) => row.id === id);
  return {
    ...summary,
    id: campaign.id,
    name: campaign.name,
    kind: campaign.kind,
    body: campaign.body,
    offerText: campaign.offerText,
    filters: campaign.filters.map((filter) => ({ field: filter.field, value: filter.value })),
    messages: messages.map((row) => ({ id: row.id, to: row.recipient, customer: row.customer, body: row.body, status: row.status, tries: row.attempts, parts: row.segments, note: row.lastError })),
  };
}

/** What the campaign builder offers to pick from: districts, customer types, categories and (the first 500) products. */
export async function campaignChoices(organizationId: string) {
  const [districts, types, categories, products, templates] = await Promise.all([
    prisma.district.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, bnName: true } }),
    prisma.customerType.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { organizationId, status: "ACTIVE", deletedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, sku: true } }),
    prisma.smsTemplate.findMany({ where: { organizationId, status: "ACTIVE", kind: { in: ["OFFER", "DUE_REMINDER"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, body: true } }),
  ]);
  return {
    districts: districts.map((row) => ({ id: String(row.id), label: `${row.name} (${row.bnName})` })),
    types: types.map((row) => ({ id: row.id, label: row.name })),
    categories: categories.map((row) => ({ id: row.id, label: row.name })),
    products: products.map((row) => ({ id: row.id, label: `${row.name} (${row.sku})` })),
    templates: templates.map((row) => ({ id: row.id, label: row.name, kind: row.kind, body: row.body })),
  };
}
