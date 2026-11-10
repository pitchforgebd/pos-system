import type { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { MONEY_ACCOUNT_RANGES as RANGES } from "../../../prisma/chart-of-accounts.ts";
import { prisma } from "@/lib/db/client";

import type { AccountRole } from "./roles";

type Db = Prisma.TransactionClient;

/** The kinds of account that hold money. A cash drawer, a bank account and a mobile wallet are told apart by kind, not by number. */
export const MONEY_KINDS = ["CASH", "BANK", "MOBILE"] as const;

/** The number ranges banks and mobile banking accounts are numbered in (defined with the chart). */
export const MONEY_ACCOUNT_RANGES = RANGES;

// Which account plays which role does not change while a transaction runs, so it is looked up once per transaction and
// remembered for the rest of it. The shared client outside a transaction is not remembered: it lives forever and the owner can
// repoint a role at any time.
const remembered = new WeakMap<object, Map<string, string>>();

function memory(db: Db) {
  if (db === (prisma as unknown)) {
    return null;
  }
  let map = remembered.get(db);
  if (!map) {
    map = new Map();
    remembered.set(db, map);
  }
  return map;
}

function missing(role: string) {
  return new RuleError(`The chart of accounts has no account for the ${role} role. Run the seed to set the chart up.`, 422);
}

/** The id of the account that plays `role` in this organization. Code asks for a role, never for an account number (B8). */
export async function accountFor(db: Db, organizationId: string, role: AccountRole): Promise<string> {
  const ids = await accountsFor(db, organizationId, [role]);
  return ids.get(role) as string;
}

/** Several roles at once (one query for the ones not yet remembered). Throws 422 naming the first role that is not set up. */
export async function accountsFor(db: Db, organizationId: string, roles: readonly AccountRole[]): Promise<Map<AccountRole, string>> {
  const memo = memory(db);
  const result = new Map<AccountRole, string>();
  const need: AccountRole[] = [];
  for (const role of new Set(roles)) {
    const known = memo?.get(`${organizationId}:${role}`);
    if (known) {
      result.set(role, known);
    } else {
      need.push(role);
    }
  }
  if (need.length > 0) {
    const rows = await db.accountRole.findMany({ where: { organizationId, role: { in: need } }, select: { role: true, accountId: true } });
    const found = new Map(rows.map((row) => [row.role, row.accountId]));
    for (const role of need) {
      const id = found.get(role);
      if (!id) {
        throw missing(role);
      }
      result.set(role, id);
      memo?.set(`${organizationId}:${role}`, id);
    }
  }
  return result;
}

/**
 * The cash, bank or mobile account a payment goes to. Without a chosen account: cash is the cash drawer, any other method
 * (bank, card ...) is the default bank account. A chosen account must be an active cash, bank or mobile account of this
 * organization.
 */
export async function moneyAccountFor(db: Db, organizationId: string, input: { method: string; accountId?: string | null }): Promise<string> {
  if (input.accountId) {
    const account = await db.account.findFirst({
      where: { id: input.accountId, organizationId, status: "ACTIVE", kind: { in: [...MONEY_KINDS] } },
      select: { id: true },
    });
    if (!account) {
      throw new RuleError("That cash or bank account is not active.", 422);
    }
    return account.id;
  }
  return accountFor(db, organizationId, input.method === "CASH" ? "CASH" : "BANK:DEFAULT");
}
