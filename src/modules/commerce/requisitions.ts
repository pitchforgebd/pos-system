import { Prisma } from "@prisma/client";
import { runTx } from "@/core/tx/run";
import { RuleError } from "@/core/errors/rule-error";
import { dateOnly } from "@/core/time/business-date";

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { hashPayload, isKeyRace, readIdempotency, saveIdempotency } from "@/core/idempotency";
import { StockRuleError } from "@/modules/inventory/stock";
import { occurredDate } from "@/lib/format/date";

type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
};

function dateString(value: Date) {
  return dateOnly(value);
}

function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const code = error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return { ok: false, status: error.status, code, message: error.message };
  }
  if (isKeyRace(error)) {
    throw error;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

export async function listRequisitions(organizationId: string, branchId: string) {
  const rows = await prisma.requisition.findMany({
    where: { organizationId, branchId },
    orderBy: { businessDate: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      status: true,
      businessDate: true,
      note: true,
      requestedBy: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    businessDate: dateString(row.businessDate),
    note: row.note,
    requesterName: row.requestedBy.name,
  }));
}

export async function getRequisition(organizationId: string, branchId: string, id: string) {
  const row = await prisma.requisition.findFirst({
    where: { id, organizationId, branchId },
    select: {
      id: true,
      number: true,
      status: true,
      businessDate: true,
      note: true,
      requestedBy: { select: { name: true } },
    },
  });
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    businessDate: dateString(row.businessDate),
    note: row.note,
    requesterName: row.requestedBy.name,
  };
}

export async function createRequisition(input: Actor & { businessDate: string; note: string }) {
  const note = input.note.trim();
  if (!note || note.length > 255) {
    return { ok: false as const, status: 422 as const, code: "BUSINESS_RULE" as const, message: "Enter a note of up to 255 characters." };
  }
  const requestHash = hashPayload({ businessDate: input.businessDate, note });
  try {
    const data = await runTx(async (tx) => {
      const existing = await readIdempotency(tx, {
        organizationId: input.organizationId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (existing === "mismatch") {
        throw new StockRuleError("This idempotency key was already used for a different request.", 409);
      }
      if (existing) {
        const requisition = await tx.requisition.findFirst({
          where: { id: existing.entityId, organizationId: input.organizationId },
          select: { id: true, number: true },
        });
        return { id: existing.entityId, number: requisition?.number ?? null, replayed: true };
      }
      const number = await allocateNumber(tx, {
        organizationId: input.organizationId,
        documentType: "REQ",
        businessDate: input.businessDate,
      });
      const requisition = await tx.requisition.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId,
          number,
          businessDate: occurredDate(input.businessDate),
          note,
          requestedById: input.userId,
        },
        select: { id: true, number: true },
      });
      await saveIdempotency(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        key: input.idempotencyKey,
        requestHash,
        entityType: "requisition",
        entityId: requisition.id,
      });
      return { id: requisition.id, number: requisition.number, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({
        organizationId: input.organizationId,
        branchId: input.branchId,
        userId: input.userId,
        action: "create",
        module: "requisitions",
        entityType: "requisition",
        entityId: data.id,
        after: { number: data.number },
        ip: input.ip,
        userAgent: input.userAgent,
      });
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

async function moveRequisition(input: {
  organizationId: string;
  branchId: string;
  userId: string;
  requisitionId: string;
  from: "REQUESTED" | "APPROVED";
  to: "APPROVED" | "REJECTED" | "FULFILLED";
  action: string;
  message: string;
  ip: string;
  userAgent: string | null;
}) {
  try {
    const data = await runTx(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM requisitions
        WHERE id = ${input.requisitionId} AND organizationId = ${input.organizationId} AND branchId = ${input.branchId}
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) {
        throw new StockRuleError("That record was not found.", 404);
      }
      if (current.status !== input.from) {
        throw new StockRuleError(input.message);
      }
      await tx.requisition.update({
        where: { id: current.id },
        data: {
          status: input.to,
          decidedById: input.to === "FULFILLED" ? undefined : input.userId,
        },
      });
      return { id: current.id };
    });
    await writeAudit({
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.userId,
      action: input.action,
      module: "requisitions",
      entityType: "requisition",
      entityId: data.id,
      after: { status: input.to },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: true as const, id: data.id };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export function approveRequisition(input: {
  organizationId: string;
  branchId: string;
  userId: string;
  requisitionId: string;
  ip: string;
  userAgent: string | null;
}) {
  return moveRequisition({
    ...input,
    from: "REQUESTED",
    to: "APPROVED",
    action: "approve",
    message: "Only a requested requisition can be approved.",
  });
}

export function rejectRequisition(input: {
  organizationId: string;
  branchId: string;
  userId: string;
  requisitionId: string;
  ip: string;
  userAgent: string | null;
}) {
  return moveRequisition({
    ...input,
    from: "REQUESTED",
    to: "REJECTED",
    action: "reject",
    message: "Only a requested requisition can be rejected.",
  });
}

export function fulfillRequisition(input: {
  organizationId: string;
  branchId: string;
  userId: string;
  requisitionId: string;
  ip: string;
  userAgent: string | null;
}) {
  return moveRequisition({
    ...input,
    from: "APPROVED",
    to: "FULFILLED",
    action: "fulfill",
    message: "Only an approved requisition can be fulfilled.",
  });
}
