import type { Prisma, PrismaClient } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { businessDate, dateOnly, daysBetween, isIsoDate } from "@/core/time/business-date";

type Db = PrismaClient | Prisma.TransactionClient;

export type PeriodReason = "FUTURE" | "LOCKED" | "BACKDATE";

/** A posting date the organization's period rules refuse. A 422 answer, never a 500. */
export class PeriodError extends RuleError {
  reason: PeriodReason;

  constructor(reason: PeriodReason, message: string) {
    super(message, 422);
    this.name = "PeriodError";
    this.reason = reason;
  }
}

export type PostingContext = {
  organizationId: string;
  /**
   * Whether the user may post a date older than the back-date window (the posting.backdate permission).
   * Leave it out where the user is unknown (the posting engine): the window is then not checked.
   * The route layer knows the session and passes true or false.
   */
  canBackdate?: boolean;
  /**
   * The user who posts. When `canBackdate` is left out and the date is older than the window, the user's own roles are asked whether
   * they hold posting.backdate (the posting engine passes the journal's creator, so every posting keeps the window, D18).
   */
  userId?: string;
};

/**
 * Throws a PeriodError unless `date` (YYYY-MM-DD) may be posted:
 *  - not after today in the organization's time zone (default Asia/Dhaka),
 *  - after the organization's lockedThrough date (invariant I11),
 *  - not older than backdateDays (default 3, decision D18) unless `canBackdate` is true.
 * `now` is only for tests.
 */
export async function assertPostable(db: Db, ctx: PostingContext, date: string, now: Date = new Date()): Promise<void> {
  if (!isIsoDate(date)) {
    throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${date}`);
  }
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { timezone: true, lockedThrough: true, backdateDays: true },
  });
  const today = businessDate(now, org.timezone);
  if (date > today) {
    throw new PeriodError("FUTURE", `${date} is in the future. Posting is allowed up to today (${today}).`);
  }
  if (org.lockedThrough && date <= dateOnly(org.lockedThrough)) {
    throw new PeriodError("LOCKED", `The period up to ${dateOnly(org.lockedThrough)} is locked. ${date} cannot be posted.`);
  }
  if (daysBetween(date, today) > org.backdateDays && ctx.canBackdate !== true && (ctx.canBackdate === false || (ctx.userId && !(await holdsBackdate(db, ctx.organizationId, ctx.userId))))) {
    throw new PeriodError(
      "BACKDATE",
      `${date} is more than ${org.backdateDays} days back. Posting that far back needs the posting.backdate permission.`,
    );
  }
}

/** Whether one of the user's roles grants posting.backdate. */
async function holdsBackdate(db: Db, organizationId: string, userId: string) {
  const hit = await db.userRole.findFirst({
    where: { organizationId, userId, role: { permissions: { some: { permission: { code: "posting.backdate" } } } } },
    select: { userId: true },
  });
  return Boolean(hit);
}
