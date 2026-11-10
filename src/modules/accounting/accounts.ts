import type { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

type Actor = { organizationId: string; userId?: string; branchId?: string | null; ip?: string; userAgent?: string | null };

async function findAccount(organizationId: string, accountId: string) {
  const account = await prisma.account.findFirst({ where: { id: accountId, organizationId } });
  if (!account) {
    throw new RuleError("That record was not found.", 404);
  }
  return account;
}

/**
 * Closes or reopens an account. A system account (one the posting rules rely on: cash, receivable, sales ...) can never be
 * closed, whoever asks (N27). A closed account takes no new postings; its history stays.
 */
export async function setAccountStatus(input: Actor & { accountId: string; status: "ACTIVE" | "INACTIVE" }) {
  const account = await findAccount(input.organizationId, input.accountId);
  if (input.status === "INACTIVE" && account.isSystem) {
    throw new RuleError("A system account cannot be deactivated.", 422);
  }
  if (account.status === input.status) {
    return { id: account.id, code: account.code, status: account.status };
  }
  const updated = await prisma.account.update({ where: { id: account.id }, data: { status: input.status }, select: { id: true, code: true, status: true } });
  await audit(input, "account status", account.id, { status: input.status });
  return updated;
}

/** Deletes an account that has never been used. A system account, or one with postings, is refused (close it instead). */
export async function deleteAccount(input: Actor & { accountId: string }) {
  const account = await findAccount(input.organizationId, input.accountId);
  if (account.isSystem) {
    throw new RuleError("A system account cannot be deleted.", 422);
  }
  const [lines, roles] = await Promise.all([
    prisma.journalLine.count({ where: { organizationId: input.organizationId, accountId: account.id } }),
    prisma.accountRole.count({ where: { organizationId: input.organizationId, accountId: account.id } }),
  ]);
  if (lines > 0 || roles > 0) {
    throw new RuleError("This account has been used. Deactivate it instead of deleting it.", 409);
  }
  await prisma.account.delete({ where: { id: account.id } });
  await audit(input, "account delete", account.id, { code: account.code });
  return { id: account.id };
}

async function audit(input: Actor, action: string, entityId: string, after: Prisma.InputJsonValue) {
  if (!input.userId) {
    return;
  }
  await writeAudit({
    organizationId: input.organizationId,
    branchId: input.branchId ?? null,
    userId: input.userId,
    action,
    module: "accounting",
    entityType: "account",
    entityId,
    after,
    ip: input.ip ?? "",
    userAgent: input.userAgent ?? null,
  });
}
