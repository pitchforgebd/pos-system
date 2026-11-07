import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";

export const TX_DEFAULTS = {
  /** A transaction may run this long. Prisma's own default is 5 seconds, too short for a big invoice or import. */
  timeoutMs: 20_000,
  /** Waiting for a free connection from the pool. */
  maxWaitMs: 5_000,
  /** Extra tries after a deadlock or write conflict. */
  retries: 3,
  /** First wait before a retry; it doubles each time, with a little jitter. */
  backoffMs: 50,
} as const;

export type TxOptions = {
  timeoutMs?: number;
  maxWaitMs?: number;
  retries?: number;
  backoffMs?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** More errors to retry, for example the idempotency-key race. */
  retryIf?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "";
}

/** MySQL deadlock (error 1213) or a Prisma write conflict (P2034). Both mean: nothing was saved, try again. */
export function isDeadlock(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") {
      return true;
    }
    if (error.code === "P2010" && String((error.meta as { code?: unknown } | undefined)?.code) === "1213") {
      return true;
    }
  }
  return /deadlock found|ER_LOCK_DEADLOCK|code:?\s*`?1213`?/i.test(errorText(error));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` in a database transaction with the application's limits (20 s, 5 s wait) and runs it again,
 * from the start, when the database picks it as the victim of a deadlock. Because `fn` can run more than
 * once, it must only touch the database through `tx` and must not send anything out (mail, SMS) itself.
 * Every other error, including every business rule (RuleError), is thrown at once.
 *
 * Take locks in one order everywhere (see lock-order.ts); that makes deadlocks rare, retries make them harmless.
 */
export async function runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options: TxOptions = {}): Promise<T> {
  const retries = options.retries ?? TX_DEFAULTS.retries;
  const backoffMs = options.backoffMs ?? TX_DEFAULTS.backoffMs;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        timeout: options.timeoutMs ?? TX_DEFAULTS.timeoutMs,
        maxWait: options.maxWaitMs ?? TX_DEFAULTS.maxWaitMs,
        ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
      });
    } catch (error) {
      const retryable = isDeadlock(error) || (options.retryIf?.(error) ?? false);
      if (!retryable || attempt >= retries) {
        throw error;
      }
      options.onRetry?.(error, attempt + 1);
      await sleep(backoffMs * 2 ** attempt + Math.floor(Math.random() * backoffMs));
    }
  }
}
