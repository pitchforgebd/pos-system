import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { addDays, businessDate as today } from "../time/business-date.ts";
import { runTx } from "../tx/run.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { RuleError } from "../errors/rule-error.ts";
import { PostingError } from "./errors.ts";
import { post } from "./journal.ts";

// P02 task 4: the journal half of the posting engine. One call writes the journal and all its lines, or nothing, and
// refuses what the ledger must never hold: an unbalanced entry (I1), a receivable or payable line without a party or a party
// on any other line (I2), a closed account, a locked or future date (I11), a second journal for the same document.

const D = (value: string) => new Prisma.Decimal(value);
const date = (iso = today()) => new Date(`${iso}T00:00:00.000Z`);

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

function plan(t: T, lines: Parameters<typeof post>[1]["lines"], extra: Partial<Parameters<typeof post>[1]> = {}): Parameters<typeof post>[1] {
  return {
    organizationId: t.org.id,
    branchId: t.branch.id,
    businessDate: date(),
    description: "test",
    createdById: t.owner.id,
    doc: { type: "JOURNAL", id: randomUUID() },
    lines,
    ...extra,
  };
}

const refuses = (status = 422) => (error: unknown) => error instanceof PostingError && error.status === status;
const counts = (t: T) => Promise.all([prisma.journal.count({ where: { organizationId: t.org.id } }), prisma.journalLine.count({ where: { organizationId: t.org.id } })]);

test("a balanced entry is saved with all its lines, each carrying the date, branch, party and shift", async () => {
  await withTestOrg(async (t) => {
    const customer = await factories(t).customer();
    const shift = await prisma.shift.create({ data: { organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id } });
    const id = await runTx((tx) =>
      post(
        tx,
        plan(t, [
          { role: "CASH", debit: D("30.00"), credit: D("0"), shiftId: shift.id },
          { role: "AR", debit: D("70.00"), credit: D("0"), party: { type: "CUSTOMER", id: customer.id } },
          { role: "SALES", debit: D("0"), credit: D("100.00") },
        ]),
      ),
    );
    const journal = await prisma.journal.findUniqueOrThrow({ where: { id }, include: { lines: { include: { account: true } } } });
    assert.equal(journal.status, "POSTED");
    assert.equal(journal.kind, "POSTING");
    assert.equal(journal.lines.length, 3);
    const byName = new Map(journal.lines.map((line) => [line.account.name, line]));
    assert.equal(byName.get("Accounts Receivable")?.partyId, customer.id);
    assert.equal(byName.get("Accounts Receivable")?.partyType, "CUSTOMER");
    assert.equal(byName.get("Cash in Hand")?.shiftId, shift.id);
    assert.equal(byName.get("Sales")?.partyId, null);
    for (const line of journal.lines) {
      assert.equal(line.branchId, t.branch.id);
      assert.equal(line.businessDate.toISOString().slice(0, 10), today());
    }
  });
});

test("an unbalanced entry, or a line that is not exactly one side above zero, is refused and nothing is written (I1)", async () => {
  await withTestOrg(async (t) => {
    const before = await counts(t);
    const bad: Array<[string, Parameters<typeof post>[1]["lines"]]> = [
      ["unbalanced", [{ role: "CASH", debit: D("10"), credit: D("0") }, { role: "SALES", debit: D("0"), credit: D("9.99") }]],
      ["both sides", [{ role: "CASH", debit: D("5"), credit: D("5") }, { role: "SALES", debit: D("0"), credit: D("0.01") }]],
      ["a zero line", [{ role: "CASH", debit: D("10"), credit: D("0") }, { role: "SALES", debit: D("0"), credit: D("10") }, { role: "MISC", debit: D("0"), credit: D("0") }]],
      ["a negative line", [{ role: "CASH", debit: D("-5"), credit: D("0") }, { role: "SALES", debit: D("0"), credit: D("-5") }]],
      ["no lines", []],
      ["one line", [{ role: "CASH", debit: D("10"), credit: D("0") }]],
    ];
    for (const [name, lines] of bad) {
      await assert.rejects(runTx((tx) => post(tx, plan(t, lines))), refuses(), name);
    }
    assert.deepEqual(await counts(t), before);
  });
});

test("receivable, payable, advance and courier lines need a party of the right kind, other lines must have none (I2)", async () => {
  await withTestOrg(async (t) => {
    const customer = await factories(t).customer();
    const vendor = await factories(t).vendor();
    const courier = await prisma.courier.create({ data: { organizationId: t.org.id, name: "Fast Courier" } });
    const money = { debit: D("0"), credit: D("50.00") } as const;
    const ok = async (role: "AR" | "AP" | "COURIER_AR" | "CUSTOMER_ADVANCE" | "VENDOR_ADVANCE", party: { type: "CUSTOMER" | "VENDOR" | "COURIER"; id: string }) => {
      const debitSide = role === "AR" || role === "COURIER_AR" || role === "VENDOR_ADVANCE";
      return runTx((tx) =>
        post(
          tx,
          plan(t, [
            { role, debit: debitSide ? D("50.00") : D("0"), credit: debitSide ? D("0") : D("50.00"), party },
            { role: "CASH", debit: debitSide ? D("0") : D("50.00"), credit: debitSide ? D("50.00") : D("0") },
          ]),
        ),
      );
    };
    await ok("AR", { type: "CUSTOMER", id: customer.id });
    await ok("CUSTOMER_ADVANCE", { type: "CUSTOMER", id: customer.id });
    await ok("AP", { type: "VENDOR", id: vendor.id });
    await ok("VENDOR_ADVANCE", { type: "VENDOR", id: vendor.id });
    await ok("COURIER_AR", { type: "COURIER", id: courier.id });

    const before = await counts(t);
    const noParty = [{ role: "AR" as const, debit: D("50"), credit: D("0") }, { role: "CASH" as const, ...money }];
    await assert.rejects(runTx((tx) => post(tx, plan(t, noParty))), refuses(), "a receivable line without a party");
    const wrongKind = [{ role: "AR" as const, debit: D("50"), credit: D("0"), party: { type: "VENDOR" as const, id: vendor.id } }, { role: "CASH" as const, ...money }];
    await assert.rejects(runTx((tx) => post(tx, plan(t, wrongKind))), refuses(), "a vendor on a receivable line");
    const partyOnCash = [{ role: "CASH" as const, debit: D("50"), credit: D("0"), party: { type: "CUSTOMER" as const, id: customer.id } }, { role: "SALES" as const, ...money }];
    await assert.rejects(runTx((tx) => post(tx, plan(t, partyOnCash))), refuses(), "a party on a cash line");
    const stranger = [{ role: "AR" as const, debit: D("50"), credit: D("0"), party: { type: "CUSTOMER" as const, id: randomUUID() } }, { role: "SALES" as const, ...money }];
    await assert.rejects(runTx((tx) => post(tx, plan(t, stranger))), refuses(404), "a customer that does not exist");
    await withTestOrg(async (other) => {
      const theirs = await factories(other).customer();
      const foreign = [{ role: "AR" as const, debit: D("50"), credit: D("0"), party: { type: "CUSTOMER" as const, id: theirs.id } }, { role: "SALES" as const, ...money }];
      await assert.rejects(runTx((tx) => post(tx, plan(t, foreign))), refuses(404), "another organization's customer");
    });
    assert.deepEqual(await counts(t), before);
  });
});

test("a closed account, another organization's account and an unknown code are refused", async () => {
  await withTestOrg(async (t) => {
    const group = await prisma.accountGroup.findFirstOrThrow({ where: { organizationId: t.org.id, code: "6000" } });
    const closed = await prisma.account.create({ data: { organizationId: t.org.id, groupId: group.id, code: "6150", name: "Closed", status: "INACTIVE" } });
    const open = await prisma.account.create({ data: { organizationId: t.org.id, groupId: group.id, code: "6160", name: "Open" } });
    const cash = { role: "CASH" as const, debit: D("0"), credit: D("5") };
    await assert.rejects(runTx((tx) => post(tx, plan(t, [{ accountId: closed.id, debit: D("5"), credit: D("0") }, cash]))), refuses());
    await assert.rejects(runTx((tx) => post(tx, plan(t, [{ accountCode: "NO-SUCH", debit: D("5"), credit: D("0") }, cash]))), refuses());
    await withTestOrg(async (other) => {
      const theirs = await prisma.account.findFirstOrThrow({ where: { organizationId: other.org.id, kind: "CASH" } });
      await assert.rejects(runTx((tx) => post(tx, plan(t, [{ accountId: theirs.id, debit: D("5"), credit: D("0") }, cash]))), refuses());
    });
    // an account the user picked by id or by code works, and so does a mix
    await runTx((tx) => post(tx, plan(t, [{ accountId: open.id, debit: D("5"), credit: D("0") }, cash])));
    await runTx((tx) => post(tx, plan(t, [{ accountCode: "6160", debit: D("5"), credit: D("0") }, cash])));
  });
});

test("the period rules hold: not tomorrow, not into a locked period (I11)", async () => {
  await withTestOrg(async (t) => {
    const lines = [{ role: "CASH" as const, debit: D("5"), credit: D("0") }, { role: "SALES" as const, debit: D("0"), credit: D("5") }];
    // a period violation is a PeriodError: a RuleError, so the user gets a 422 like for any other refusal
    const period = (error: unknown) => error instanceof RuleError && error.status === 422 && error.name === "PeriodError";
    await assert.rejects(runTx((tx) => post(tx, plan(t, lines, { businessDate: date(addDays(today(), 1)) }))), period);
    await prisma.organization.update({ where: { id: t.org.id }, data: { lockedThrough: date(addDays(today(), -1)) } });
    await assert.rejects(runTx((tx) => post(tx, plan(t, lines, { businessDate: date(addDays(today(), -1)) }))), period);
    await runTx((tx) => post(tx, plan(t, lines)));
  });
});

test("a document has one posting and one reversal: a second journal for the same document is refused (409)", async () => {
  await withTestOrg(async (t) => {
    const lines = [{ role: "CASH" as const, debit: D("5"), credit: D("0") }, { role: "SALES" as const, debit: D("0"), credit: D("5") }];
    const doc = { type: "SALE" as const, id: randomUUID() };
    await runTx((tx) => post(tx, plan(t, lines, { doc })));
    await assert.rejects(runTx((tx) => post(tx, plan(t, lines, { doc }))), refuses(409));
    const reversalLines = [{ role: "CASH" as const, debit: D("0"), credit: D("5") }, { role: "SALES" as const, debit: D("5"), credit: D("0") }];
    const original = await prisma.journal.findFirstOrThrow({ where: { docId: doc.id } });
    await runTx((tx) => post(tx, plan(t, reversalLines, { doc, kind: "REVERSAL", reversalOfId: original.id })));
    await assert.rejects(runTx((tx) => post(tx, plan(t, reversalLines, { doc, kind: "REVERSAL", reversalOfId: original.id }))), refuses(409));
    assert.equal(await prisma.journal.count({ where: { docId: doc.id } }), 2);
  });
});

test("when a later step fails, the journal and its lines are undone with everything else in the transaction", async () => {
  await withTestOrg(async (t) => {
    const before = await counts(t);
    await assert.rejects(
      runTx(async (tx) => {
        await post(tx, plan(t, [{ role: "CASH", debit: D("5"), credit: D("0") }, { role: "SALES", debit: D("0"), credit: D("5") }]));
        throw new Error("the document could not be saved");
      }),
      /could not be saved/,
    );
    assert.deepEqual(await counts(t), before);
  });
});

test("the old entry point still works and is the same engine", async () => {
  const { postBalancedJournal } = await import("../../modules/accounting/post.ts");
  await withTestOrg(async (t) => {
    const id = await runTx((tx) => postBalancedJournal(tx, plan(t, [{ role: "CASH", debit: D("5"), credit: D("0") }, { role: "SALES", debit: D("0"), credit: D("5") }])));
    assert.equal((await prisma.journal.findUniqueOrThrow({ where: { id } })).status, "POSTED");
    await assert.rejects(runTx((tx) => postBalancedJournal(tx, plan(t, [{ role: "AR", debit: D("5"), credit: D("0") }, { role: "SALES", debit: D("0"), credit: D("5") }]))), refuses());
  });
});

test("partyLineViolations finds a bad line that got into the ledger some other way, and says which", async () => {
  const { partyLineViolations } = await import("./invariants.ts");
  await withTestOrg(async (t) => {
    assert.deepEqual(await partyLineViolations(prisma, t.org.id), []);
    const customer = await factories(t).customer();
    const ar = await prisma.accountRole.findUniqueOrThrow({ where: { organizationId_role: { organizationId: t.org.id, role: "AR" } } });
    const cash = await prisma.accountRole.findUniqueOrThrow({ where: { organizationId_role: { organizationId: t.org.id, role: "CASH" } } });
    const day = new Date(`${today()}T00:00:00.000Z`);
    const bad = await prisma.journal.create({
      data: {
        organizationId: t.org.id, branchId: t.branch.id, businessDate: day, status: "POSTED",
        lines: {
          create: [
            { organizationId: t.org.id, accountId: ar.accountId, debit: "10.00", businessDate: day, branchId: t.branch.id },
            { organizationId: t.org.id, accountId: ar.accountId, debit: "10.00", businessDate: day, branchId: t.branch.id, partyType: "VENDOR", partyId: randomUUID() },
            { organizationId: t.org.id, accountId: cash.accountId, credit: "20.00", businessDate: day, branchId: t.branch.id, partyType: "CUSTOMER", partyId: customer.id },
            { organizationId: t.org.id, accountId: ar.accountId, debit: "5.00", businessDate: day, branchId: t.branch.id, partyType: "CUSTOMER", partyId: customer.id },
            { organizationId: t.org.id, accountId: cash.accountId, credit: "5.00", businessDate: day, branchId: t.branch.id },
          ],
        },
      },
      include: { lines: true },
    });
    const found = await partyLineViolations(prisma, t.org.id);
    assert.equal(found.length, 3, "the three bad lines, not the good ones");
    const problems = found.map((v) => v.problem).sort();
    assert.deepEqual(problems, ["AR line about a vendor, expected a customer", "AR line without a party", "a party on a line that is not receivable, payable or advance"]);
    assert.equal(new Set(found.map((v) => v.lineId)).size, 3);
    assert.ok(found.every((v) => bad.lines.some((line) => line.id === v.lineId)));
  });
});
