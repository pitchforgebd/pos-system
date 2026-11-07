import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export async function readIdempotency(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; key: string; requestHash: string },
) {
  const existing = await tx.idempotencyKey.findUnique({
    where: { organizationId_key: { organizationId: input.organizationId, key: input.key } },
  });
  if (!existing) {
    return null;
  }
  if (existing.requestHash !== input.requestHash) {
    return "mismatch" as const;
  }
  return existing;
}

// Errors raised because another request with the same key committed first.
const keyRaces = new WeakSet<object>();

export async function saveIdempotency(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; userId: string; key: string; requestHash: string; entityType: string; entityId: string },
) {
  try {
    await tx.idempotencyKey.create({ data: input });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      keyRaces.add(error);
    }
    throw error;
  }
}

/**
 * Runs a transaction that saves an idempotency key. If a parallel request with the same key
 * commits first, this attempt is rolled back and run once more, so it finds the saved key and
 * replays that result instead of failing.
 */
export async function idempotentTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(run);
  } catch (error) {
    if (typeof error === "object" && error !== null && keyRaces.has(error)) {
      return prisma.$transaction(run);
    }
    throw error;
  }
}
