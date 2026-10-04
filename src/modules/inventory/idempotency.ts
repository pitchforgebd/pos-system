import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

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

export async function saveIdempotency(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; userId: string; key: string; requestHash: string; entityType: string; entityId: string },
) {
  await tx.idempotencyKey.create({ data: input });
}
