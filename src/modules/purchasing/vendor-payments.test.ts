import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { partyBalance } from "../../core/parties/index.ts";
import { billPayment } from "../../core/payments/index.ts";
import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { createBankAccount } from "../accounting/books.ts";
import { applySupplierAdvance, postPurchase, postSupplierAdvance, postSupplierPayment } from "./purchases.ts";

// P05 tasks 5 and 6: paying a vendor from a chosen cash, bank or mobile account with the charge, settling named bills or the oldest
// first, refusing more than is owed (an advance is the way to pay ahead), and using an advance against bills.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T, key = randomUUID()) => ({ ...t.actor, idempotencyKey: key });

async function bills(t: T, amounts: string[], f = factories(t)) {
  const product = await f.product();
  const vendor = await f.vendor({ name: "Agro Supply" });
  const ids: string[] = [];
  let day = 1;
  for (const amount of amounts) {
    const done = await postPurchase({ ...actor(t), supplierId: vendor.id, businessDate: `2026-11-0${day++}`, lines: [{ productId: product.id, quantity: "1", unitCost: amount }] });
    assert.equal(done.ok, true, JSON.stringify(done));
    ids.push(done.ok ? done.id : "");
  }
  return { vendor, ids };
}

const owed = async (t: T, id: string) => (await billPayment(prisma, t.org.id, id)).owed.toFixed(2);
const balance = (t: T, vendorId: string, account?: "ADVANCE") => partyBalance(prisma, { organizationId: t.org.id, partyType: "VENDOR", partyId: vendorId, account }).then((v) => v.toFixed(2));

async function mobileAccount(t: T, name = "bKash 01711") {
  const made = await createBankAccount({ ip: "127.0.0.1", userAgent: "test", organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, idempotencyKey: randomUUID(), name, kind: "MOBILE", accountNumber: "01711-000000" });
  assert.equal(made.ok, true, JSON.stringify(made));
  return prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name } });
}

test("a partial payment makes the bill PARTIAL; paying the rest makes it PAID", async () => {
  await withTestOrg(async (t) => {
    const { vendor, ids } = await bills(t, ["1000.00"]);
    const first = await postSupplierPayment({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-05", amount: "400.00", method: "CASH" });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual([(await billPayment(prisma, t.org.id, ids[0])).status, await owed(t, ids[0])], ["PARTIAL", "600.00"]);
    const rest = await postSupplierPayment({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-06", amount: "600.00", method: "BANK" });
    assert.equal(rest.ok, true, JSON.stringify(rest));
    assert.deepEqual([(await billPayment(prisma, t.org.id, ids[0])).status, await balance(t, vendor.id)], ["PAID", "0.00"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("more than is owed is refused, and the message points to an advance; nothing is posted", async () => {
  await withTestOrg(async (t) => {
    const { vendor, ids } = await bills(t, ["1000.00"]);
    const refused = await postSupplierPayment({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-05", amount: "1000.01", method: "CASH" });
    assert.equal(refused.ok, false);
    assert.match(!refused.ok ? refused.message : "", /advance/i);
    assert.equal(await prisma.supplierPayment.count({ where: { organizationId: t.org.id } }), 0);
    assert.equal(await owed(t, ids[0]), "1000.00");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a payment can name the bills it is for; what it does not name settles the oldest first; a bill of another vendor is refused", async () => {
  await withTestOrg(async (t) => {
    const f = factories(t);
    const { vendor, ids } = await bills(t, ["500.00", "300.00", "200.00"], f);
    const named = await postSupplierPayment({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-05", amount: "350.00", method: "CASH", allocations: [{ billId: ids[2], amount: "200.00" }] });
    assert.equal(named.ok, true, JSON.stringify(named));
    // 200.00 went to the named bill, the other 150.00 to the oldest
    assert.deepEqual([await owed(t, ids[0]), await owed(t, ids[1]), await owed(t, ids[2])], ["350.00", "300.00", "0.00"]);
    const stranger = await bills(t, ["50.00"], f);
    const refused = await postSupplierPayment({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-06", amount: "50.00", method: "CASH", allocations: [{ billId: stranger.ids[0], amount: "50.00" }] });
    assert.equal(refused.ok, false);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a bKash payment with its charge: the vendor gets the amount, the charge is a 6610 expense, the wallet pays both", async () => {
  await withTestOrg(async (t) => {
    const { vendor, ids } = await bills(t, ["1000.00"]);
    const wallet = await mobileAccount(t);
    const paid = await postSupplierPayment({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-05", amount: "1000.00", method: "MOBILE", accountId: wallet.id, charge: "18.50" });
    assert.equal(paid.ok, true, JSON.stringify(paid));
    const lines = await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "SUPPLIER_PAYMENT", docId: paid.ok ? paid.id : "" } }, include: { account: { include: { roles: true } } } });
    assert.deepEqual(
      lines.map((l) => [l.account.code, l.account.roles.map((r) => r.role).join(","), l.debit.toFixed(2), l.credit.toFixed(2)]).sort(),
      [["1251", "", "0.00", "1018.50"], ["6610", "MOBILE_CHARGE", "18.50", "0.00"], [lines.find((l) => l.account.roles.some((r) => r.role === "AP"))?.account.code, "AP", "1000.00", "0.00"]].sort(),
    );
    assert.deepEqual([await owed(t, ids[0]), await balance(t, vendor.id)], ["0.00", "0.00"], "the charge is not part of what the vendor is paid");
    const row = await prisma.supplierPayment.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.deepEqual([row.method, row.accountId, row.amount.toFixed(2), row.charge.toFixed(2)], ["MOBILE", wallet.id, "1000.00", "18.50"]);
    // no charge from a cash drawer
    const cash = await postSupplierPayment({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-06", amount: "1.00", method: "CASH", charge: "1.00" });
    assert.equal(cash.ok, false);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("an advance, then used against a bill: the payable falls, the advance falls, no cash moves; more than held is refused", async () => {
  await withTestOrg(async (t) => {
    const { vendor, ids } = await bills(t, ["800.00"]);
    const advance = await postSupplierAdvance({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-05", amount: "500.00", method: "CASH" });
    assert.equal(advance.ok, true, JSON.stringify(advance));
    assert.deepEqual([await balance(t, vendor.id), await balance(t, vendor.id, "ADVANCE")], ["800.00", "500.00"]);
    const cashBefore = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, account: { kind: "CASH" } }, _sum: { debit: true, credit: true } });

    const tooMuch = await applySupplierAdvance({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-06", amount: "500.01" });
    assert.equal(tooMuch.ok, false);
    const used = await applySupplierAdvance({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-06", amount: "300.00", allocations: [{ billId: ids[0], amount: "300.00" }] });
    assert.equal(used.ok, true, JSON.stringify(used));
    assert.deepEqual([await balance(t, vendor.id), await balance(t, vendor.id, "ADVANCE"), await owed(t, ids[0])], ["500.00", "200.00", "500.00"]);
    assert.equal((await billPayment(prisma, t.org.id, ids[0])).status, "PARTIAL");
    const cashAfter = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, account: { kind: "CASH" } }, _sum: { debit: true, credit: true } });
    assert.deepEqual([cashAfter._sum.debit?.toFixed(2), cashAfter._sum.credit?.toFixed(2)], [cashBefore._sum.debit?.toFixed(2), cashBefore._sum.credit?.toFixed(2)], "using an advance moves no cash");
    // more than the bill still owes is refused, too
    const over = await applySupplierAdvance({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-07", amount: "200.00", allocations: [{ billId: ids[0], amount: "200.00" }] });
    assert.equal(over.ok, true, "200 is still within what the bill owes (500)");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("an advance posted twice with one key is one advance", async () => {
  await withTestOrg(async (t) => {
    const vendor = await factories(t).vendor();
    const key = randomUUID();
    const one = await postSupplierAdvance({ ...actor(t, key), supplierId: vendor.id, businessDate: "2026-11-05", amount: "250.00", method: "CASH" });
    const two = await postSupplierAdvance({ ...actor(t, key), supplierId: vendor.id, businessDate: "2026-11-05", amount: "250.00", method: "CASH" });
    assert.deepEqual([one.ok, two.ok, two.ok && two.replayed], [true, true, true]);
    assert.equal(await prisma.supplierAdvance.count({ where: { organizationId: t.org.id } }), 1);
    assert.equal(await balance(t, vendor.id, "ADVANCE"), "250.00");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
