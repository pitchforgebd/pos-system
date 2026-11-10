import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { permissionCodes } from "../../lib/permissions/codes.ts";
import { postBalancedJournal } from "../../modules/accounting/post.ts";
import { postOpeningStock } from "../../modules/inventory/documents.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { RuleError } from "../errors/rule-error.ts";
import { addDays, businessDate } from "./business-date.ts";
import { PeriodError, assertPostable } from "./period.ts";

// Period rules (N9, invariant I11): nothing is posted after today (Asia/Dhaka), nothing on or before
// the organization's lockedThrough date, and a date older than backdateDays needs posting.backdate.

async function rejectsWith(promise: Promise<unknown>, reason: "FUTURE" | "LOCKED" | "BACKDATE") {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal(error instanceof PeriodError, true);
    assert.equal(error instanceof RuleError, true);
    assert.equal((error as PeriodError).reason, reason);
    assert.equal((error as PeriodError).status, 422);
    return true;
  });
}

test("posting.backdate is in the permission catalog", () => {
  assert.equal((permissionCodes as readonly string[]).includes("posting.backdate"), true);
});

test("today and yesterday are postable, tomorrow is not, whatever the permission", async () => {
  await withTestOrg(async (t) => {
    const today = businessDate();
    const ctx = { organizationId: t.org.id };
    await assertPostable(prisma, ctx, today);
    await assertPostable(prisma, ctx, addDays(today, -1));
    await rejectsWith(assertPostable(prisma, ctx, addDays(today, 1)), "FUTURE");
    await rejectsWith(assertPostable(prisma, { ...ctx, canBackdate: true }, addDays(today, 1)), "FUTURE");
  });
});

test("today is the organization's day: Dhaka by default, another zone when the organization has one", async () => {
  await withTestOrg(async (t) => {
    const ctx = { organizationId: t.org.id };
    const now = new Date("2026-11-07T18:30:00.000Z"); // 00:30 on 8 November in Dhaka, still 7 November in UTC
    await assertPostable(prisma, ctx, "2026-11-08", now);
    await rejectsWith(assertPostable(prisma, ctx, "2026-11-09", now), "FUTURE");
    await prisma.organization.update({ where: { id: t.org.id }, data: { timezone: "UTC" } });
    await rejectsWith(assertPostable(prisma, ctx, "2026-11-08", now), "FUTURE");
    await assertPostable(prisma, ctx, "2026-11-07", now);
  });
});

test("the back-date window needs posting.backdate, and only when the caller says who is posting", async () => {
  await withTestOrg(async (t) => {
    const today = businessDate();
    const inside = addDays(today, -3);
    const outside = addDays(today, -4);
    await assertPostable(prisma, { organizationId: t.org.id, canBackdate: false }, inside);
    await rejectsWith(assertPostable(prisma, { organizationId: t.org.id, canBackdate: false }, outside), "BACKDATE");
    await assertPostable(prisma, { organizationId: t.org.id, canBackdate: true }, outside);
    // The posting engine does not know the user's permissions; the route layer passes canBackdate.
    await assertPostable(prisma, { organizationId: t.org.id }, outside);
    await prisma.organization.update({ where: { id: t.org.id }, data: { backdateDays: 10 } });
    await assertPostable(prisma, { organizationId: t.org.id, canBackdate: false }, addDays(today, -10));
    await rejectsWith(assertPostable(prisma, { organizationId: t.org.id, canBackdate: false }, addDays(today, -11)), "BACKDATE");
  });
});

test("a locked period stays closed for everybody, on the lock date and before it", async () => {
  await withTestOrg(async (t) => {
    const today = businessDate();
    const locked = addDays(today, -10);
    await prisma.organization.update({ where: { id: t.org.id }, data: { lockedThrough: new Date(`${locked}T00:00:00.000Z`) } });
    const ctx = { organizationId: t.org.id, canBackdate: true };
    await rejectsWith(assertPostable(prisma, ctx, locked), "LOCKED");
    await rejectsWith(assertPostable(prisma, ctx, addDays(locked, -30)), "LOCKED");
    await assertPostable(prisma, ctx, addDays(locked, 1));
    await prisma.organization.update({ where: { id: t.org.id }, data: { lockedThrough: null } });
    await assertPostable(prisma, ctx, locked);
  });
});

test("an invalid date is a programming error, not a period error", async () => {
  await withTestOrg(async (t) => {
    await assert.rejects(assertPostable(prisma, { organizationId: t.org.id }, "2026-02-31"), RangeError);
  });
});

test("a journal cannot be posted for tomorrow or into a locked period", async () => {
  await withTestOrg(async (t) => {
    const today = businessDate();
    const post = (date: string) =>
      prisma.$transaction((tx) =>
        postBalancedJournal(tx, {
          organizationId: t.org.id,
          branchId: t.branch.id,
          businessDate: new Date(`${date}T00:00:00.000Z`),
          description: "period test",
          createdById: t.owner.id,
          doc: { type: "JOURNAL", id: crypto.randomUUID() },
          lines: [
            { role: "CASH", debit: new Prisma.Decimal("10.00"), credit: new Prisma.Decimal(0) },
            { role: "SALES", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal("10.00") },
          ],
        }),
      );

    await post(today);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), 1);

    await rejectsWith(post(addDays(today, 1)), "FUTURE");
    const locked = addDays(today, -5);
    await prisma.organization.update({ where: { id: t.org.id }, data: { lockedThrough: new Date(`${locked}T00:00:00.000Z`) } });
    await rejectsWith(post(locked), "LOCKED");
    await post(addDays(locked, 1));
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), 2);
  });
});

test("a stock document is refused for tomorrow or a locked day, with a 422 result", async () => {
  await withTestOrg(async (t) => {
    const today = businessDate();
    const product = await factories(t).product();
    const open = (date: string) =>
      postOpeningStock({
        ...t.actor,
        idempotencyKey: randomUUID(),
        businessDate: date,
        lines: [{ productId: product.id, quantity: "1.0000", unitCost: "10.00" }],
      });

    const future = await open(addDays(today, 1));
    assert.equal(future.ok, false);
    assert.equal(future.ok === false && future.status, 422);

    const locked = addDays(today, -5);
    await prisma.organization.update({ where: { id: t.org.id }, data: { lockedThrough: new Date(`${locked}T00:00:00.000Z`) } });
    const inLock = await open(locked);
    assert.equal(inLock.ok, false);
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: t.org.id } }), 0);

    const fine = await open(addDays(locked, 1));
    assert.equal(fine.ok, true);
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: t.org.id } }), 1);
  });
});
