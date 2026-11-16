import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { postOpeningCash } from "../../modules/accounting/books.ts";
import { createCustomer } from "../../modules/customers/customers.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { addDays, businessDate, dateOnly } from "./business-date.ts";
import { openingDate } from "./opening.ts";

// Found by the 7-day user test: every opening balance was dated the day it was typed, so a shop that started its books a week earlier
// showed its cash below zero on every day before. The owner now sets the day the books start; the openings are dated that day, by anyone
// who may enter them (an opening is not a back-dated posting).
test("opening balances are dated the day the books start; without it, the day they are entered", async () => {
  await withTestOrg(async (t) => {
    assert.equal(await openingDate(prisma, t.org.id), businessDate());
    const start = addDays(businessDate(), -15);
    await prisma.organization.update({ where: { id: t.org.id }, data: { booksStartOn: new Date(`${start}T00:00:00.000Z`) } });
    // a clerk without posting.backdate enters them
    const clerk = await prisma.user.create({ data: { organizationId: t.org.id, name: "Clerk", email: `clerk-${randomUUID()}@example.test`, passwordHash: "x" } });
    const cash = await postOpeningCash({ ...t.actor, userId: clerk.id, idempotencyKey: randomUUID(), amount: "50000.00" });
    assert.equal(cash.ok, true, JSON.stringify(cash));
    const made = await createCustomer({ organizationId: t.org.id, actorId: clerk.id, branchId: t.branch.id, name: "Old Due", openingBalance: "2500.00", districtId: 47, ip: "127.0.0.1", userAgent: "test" });
    assert.equal(made.ok, true, JSON.stringify(made));
    const days = (await prisma.journal.findMany({ where: { organizationId: t.org.id, docType: { in: ["CASH_OPENING", "CUSTOMER_OPENING"] } }, select: { businessDate: true } })).map((j) => dateOnly(j.businessDate));
    assert.deepEqual(days, [start, start]);
  });
});
