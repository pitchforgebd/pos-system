import { AsyncLocalStorage } from "node:async_hooks";

import type { Prisma } from "@prisma/client";

// The "ambient" transaction: while runTx runs a function, the transaction is stored here for everything that function
// awaits. The shared `prisma` client (src/lib/db/client.ts) then talks to that transaction, so a route can open one
// transaction and every service it calls, and the audit row, join it (a nested runTx joins instead of opening another). This file imports nothing from the database
// layer, so the client can import it without a cycle.
export type Ambient = {
  tx: Prisma.TransactionClient;
};

// One store per process, kept on globalThis like the Prisma client. The production build can include this module in
// more than one bundle; with a store per copy, runTx would write the transaction into one and the shared client
// would read another, so nothing would join the transaction and every query would take its own connection.
const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<Ambient> | undefined>;
const key = Symbol.for("meridian.ambientTransaction");
const storage = (holder[key] ??= new AsyncLocalStorage<Ambient>());

export function currentAmbient(): Ambient | undefined {
  return storage.getStore();
}

export function currentTx(): Prisma.TransactionClient | undefined {
  return storage.getStore()?.tx;
}

export function runInAmbient<T>(tx: Prisma.TransactionClient, fn: () => Promise<T>): Promise<T> {
  return storage.run({ tx }, fn);
}
