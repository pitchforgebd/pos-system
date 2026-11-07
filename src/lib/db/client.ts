import { PrismaClient } from "@prisma/client";

import { currentTx } from "@/core/tx/ambient";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; basePrisma?: PrismaClient };

// Keep one client per process. Next.js can load this module from several bundles,
// and each extra client opens its own connection pool.
export const basePrisma = globalForPrisma.basePrisma ?? new PrismaClient();

globalForPrisma.basePrisma = basePrisma;

/**
 * The client the application uses. Inside `runTx` (src/core/tx/run.ts) it is that transaction, for everything the
 * function awaits; anywhere else it is the ordinary client. `basePrisma` is always the ordinary client, with its
 * own connection, for the rare read that must not be part of the current transaction.
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new Proxy(basePrisma, {
    get(target, property) {
      const tx = currentTx() as unknown as Record<string | symbol, unknown> | undefined;
      const source = tx && property in tx ? tx : (target as unknown as Record<string | symbol, unknown>);
      const value = source[property];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(source) : value;
    },
  });

globalForPrisma.prisma = prisma;
