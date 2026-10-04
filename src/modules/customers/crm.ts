import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

export async function listAssignableUsers(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true },
  });
}

export async function listCrmContacts(organizationId: string) {
  const rows = await prisma.crmContact.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      segment: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    status: row.status,
    segmentName: row.segment?.name ?? null,
  }));
}

export async function listCrmSegments(organizationId: string) {
  return prisma.crmSegment.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true },
  });
}

export async function listCrmActivities(organizationId: string) {
  const rows = await prisma.crmActivity.findMany({
    where: { organizationId },
    orderBy: { occurredOn: "desc" },
    take: 100,
    select: { id: true, occurredOn: true, note: true, contact: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    note: row.note,
    contactName: row.contact.name,
  }));
}

export async function createCrmSegment(input: { organizationId: string; name: string }) {
  const name = input.name.trim();
  if (!name) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a segment name." };
  }
  const segment = await prisma.crmSegment.create({
    data: { organizationId: input.organizationId, name },
    select: { id: true, name: true },
  });
  return { ok: true as const, segment };
}

export async function createCrmContact(input: {
  organizationId: string;
  actorId: string;
  name: string;
  phone?: string | null;
  segmentId?: string | null;
  ip: string;
  userAgent: string | null;
}) {
  const name = input.name.trim();
  if (!name) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a contact name." };
  }
  if (input.segmentId) {
    const segment = await prisma.crmSegment.findFirst({
      where: { id: input.segmentId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!segment) {
      return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Choose a segment in this organization." };
    }
  }
  const contact = await prisma.crmContact.create({
    data: {
      organizationId: input.organizationId,
      name,
      phone: input.phone?.trim() || null,
      segmentId: input.segmentId || null,
    },
    select: { id: true, name: true },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "create",
    module: "crm",
    entityType: "crm_contact",
    entityId: contact.id,
    after: { name: contact.name },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, contact };
}

export async function createCrmActivity(input: {
  organizationId: string;
  actorId: string;
  contactId: string;
  occurredOn: string;
  note: string;
  ip: string;
  userAgent: string | null;
}) {
  const note = input.note.trim();
  if (!note) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a follow-up note." };
  }
  const contact = await prisma.crmContact.findFirst({
    where: { id: input.contactId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!contact) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  const activity = await prisma.crmActivity.create({
    data: {
      organizationId: input.organizationId,
      contactId: contact.id,
      occurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`),
      note,
    },
    select: { id: true },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "create",
    module: "crm",
    entityType: "crm_activity",
    entityId: activity.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, activity };
}

export async function createCrmAssignment(input: {
  organizationId: string;
  actorId: string;
  contactId: string;
  userId: string;
  ip: string;
  userAgent: string | null;
}) {
  const contact = await prisma.crmContact.findFirst({
    where: { id: input.contactId, organizationId: input.organizationId },
    select: { id: true },
  });
  const user = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!contact || !user) {
    return { ok: false as const, status: 404 as const, code: "NOT_FOUND" as const, message: "That record was not found." };
  }
  const existing = await prisma.crmAssignment.findFirst({
    where: { contactId: contact.id, userId: user.id },
    select: { id: true },
  });
  if (existing) {
    return { ok: false as const, status: 409 as const, code: "CONFLICT" as const, message: "That contact is already assigned to this user." };
  }
  const assignment = await prisma.crmAssignment.create({
    data: { organizationId: input.organizationId, contactId: contact.id, userId: user.id },
    select: { id: true },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "assign",
    module: "crm",
    entityType: "crm_assignment",
    entityId: assignment.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, assignment };
}
