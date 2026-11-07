// The one idempotency implementation (invariant I10). A write request carries an Idempotency-Key. The same key
// with the same request is answered with the answer of the first request and does nothing twice; the same key
// with a different request is refused (409).
import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { runTx } from "@/core/tx/run";

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

/** A fingerprint of a request that ignores the order of its fields. */
export function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

// What happened to the idempotency key inside one transaction, so `idempotentTransaction` can store the answer
// of a first request and give it back to a repeated one. Keyed by the transaction client.
type KeyContext = { existing?: { response: Prisma.JsonValue | null }; savedId?: string };
const contexts = new WeakMap<object, KeyContext>();

function contextOf(tx: Prisma.TransactionClient) {
  let context = contexts.get(tx);
  if (!context) {
    context = {};
    contexts.set(tx, context);
  }
  return context;
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
  contextOf(tx).existing = existing;
  return existing;
}

// Errors raised because another request with the same key committed first.
const keyRaces = new WeakSet<object>();

export async function saveIdempotency(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; userId: string; key: string; requestHash: string; entityType: string; entityId: string },
) {
  try {
    const row = await tx.idempotencyKey.create({ data: input });
    contextOf(tx).savedId = row.id;
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      keyRaces.add(error);
    }
    throw error;
  }
}

function isReplay(result: unknown): result is { replayed: true } {
  return typeof result === "object" && result !== null && (result as { replayed?: unknown }).replayed === true;
}

/**
 * Runs `run` in a transaction (runTx: limits and deadlock retries). When `run` saved an idempotency key, the
 * value it returns is stored with the key as the answer, as plain JSON. When `run` found the key (a repeated
 * request) and returned a replay (`replayed: true`), the stored answer of the first request is returned instead,
 * marked `replayed: true`, so a repeat gets the same number, totals and ids. A key saved before answers were
 * stored has none; its replay keeps the shape the caller built. If a parallel request with the same key
 * commits first, this attempt is rolled back and run again, so it finds the key and replays.
 */
export async function idempotentTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return runTx(
    async (tx) => {
      const result = await run(tx);
      const context = contexts.get(tx);
      if (context?.savedId) {
        const response = JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue;
        await tx.idempotencyKey.update({ where: { id: context.savedId }, data: { response } });
        return result;
      }
      const stored = context?.existing?.response;
      if (isReplay(result) && stored && typeof stored === "object" && !Array.isArray(stored)) {
        return { ...stored, replayed: true } as T;
      }
      return result;
    },
    { retryIf: (error) => typeof error === "object" && error !== null && keyRaces.has(error) },
  );
}
