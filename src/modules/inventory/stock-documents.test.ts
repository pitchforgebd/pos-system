import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { addDays, businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { postSale } from "../sales/sales.ts";
import { postAdjustment, postDamage, postOpeningStock, postOwnStock, postTakeOff, postTransfer, writeOffExpiry } from "./documents.ts";

// P03 task 4: every stock document is a stock movement and a journal made together, valued at the average cost, and the books
// agree with the stock afterwards. These tests drive each document type through its public function.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const who = (t: T) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, warehouseId: t.warehouse.id, ip: "127.0.0.1", userAgent: "test" });
const key = () => ({ idempotencyKey: randomUUID() });

async function net(t: T, role: string) {
  const mapping = await prisma.accountRole.findUniqueOrThrow({ where: { organizationId_role: { organizationId: t.org.id, role: role as never } } });
  const sums = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, accountId: mapping.accountId }, _sum: { debit: true, credit: true } });
  return Number((Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0)).toFixed(2));
}

const onHand = async (t: T, productId: string) => (await prisma.stockBalance.aggregate({ where: { organizationId: t.org.id, productId }, _sum: { quantity: true } }))._sum.quantity?.toFixed(4);

async function withStock(t: T, units = "10", cost = "6.0000") {
  const product = await factories(t).product({ purchasePrice: "6.00", sellingPrice: "10.00" });
  const done = await postOpeningStock({ ...who(t), ...key(), businessDate: today(), lines: [{ productId: product.id, quantity: units, unitCost: cost }] });
  assert.equal(done.ok, true, JSON.stringify(done));
  return product;
}

test("opening stock: stock in at its cost, Dr Inventory / Cr Opening Balance Equity, numbered, one document", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    const done = await postOpeningStock({ ...who(t), ...key(), businessDate: today(), lines: [{ productId: product.id, quantity: "10", unitCost: "6.1234" }] });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(await onHand(t, product.id), "10.0000");
    assert.equal(await net(t, "INVENTORY"), 61.23);
    assert.equal(await net(t, "OPENING_EQUITY"), -61.23);
    const header = await prisma.stockDocument.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.equal(header.type, "OPENING");
    assert.match(header.number ?? "", /^STK-\d{4}-\d{6}$/);
    assert.ok(header.journalId, "the document knows its journal");
    const journal = await prisma.journal.findUniqueOrThrow({ where: { id: header.journalId as string } });
    assert.deepEqual([journal.docType, journal.docId], ["OPENING_STOCK", header.id]);
    const row = await prisma.stockLedger.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.deepEqual([row.referenceType, row.referenceId, row.unitCost?.toFixed(4), row.totalCost?.toFixed(2)], ["stock_document", header.id, "6.1234", "61.23"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("own stock: the owner's goods are Dr Inventory / Cr Owner Capital", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    assert.equal((await postOwnStock({ ...who(t), ...key(), businessDate: today(), lines: [{ productId: product.id, quantity: "4", unitCost: "25" }] })).ok, true);
    assert.deepEqual([await net(t, "INVENTORY"), await net(t, "CAPITAL")], [100, -100]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("adjustment: stock found is a gain at the average, stock lost is a loss at the average", async () => {
  await withTestOrg(async (t) => {
    const product = await withStock(t, "10", "6.0000");
    assert.equal((await postAdjustment({ ...who(t), ...key(), productId: product.id, quantity: "2", direction: "IN", reason: "found" })).ok, true);
    assert.deepEqual([await net(t, "INVENTORY_GAIN"), await net(t, "INVENTORY")], [-12, 72]);
    assert.equal((await postAdjustment({ ...who(t), ...key(), productId: product.id, quantity: "5", direction: "OUT", reason: "count" })).ok, true);
    assert.deepEqual([await net(t, "INVENTORY_LOSS"), await net(t, "INVENTORY"), await onHand(t, product.id)], [30, 42, "7.0000"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("damage: the loss is at the average cost, whatever prices the form carries", async () => {
  await withTestOrg(async (t) => {
    const product = await withStock(t, "10", "6.0000");
    const done = await postDamage({
      ...who(t), ...key(), productId: product.id, businessDate: today(), place: "Shelf 3", purchasePrice: "99.00", salePrice: "120.00",
      discountAmount: "0.00", vatAmount: "0.00", quantity: "3", reason: "leaked",
    });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.deepEqual([await net(t, "INVENTORY_LOSS"), await net(t, "INVENTORY"), await onHand(t, product.id)], [18, 42, "7.0000"]);
    const header = await prisma.stockDocument.findFirstOrThrow({ where: { organizationId: t.org.id, type: "DAMAGE" } });
    assert.deepEqual([header.place, header.reason], ["Shelf 3", "leaked"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("expiry write-off: the named lot is reduced, the loss is at the average", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ trackExpiry: true });
    const bought = await postOpeningStock({
      ...who(t), ...key(), businessDate: today(),
      lines: [{ productId: product.id, quantity: "8", unitCost: "5", lot: "L1", expiresOn: addDays(today(), -1) }],
    });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    const lot = await prisma.expiryBatch.findFirstOrThrow({ where: { organizationId: t.org.id, productId: product.id } });
    const done = await writeOffExpiry({ ...who(t), ...key(), batchId: lot.id, quantity: "3" });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal((await prisma.expiryBatch.findUniqueOrThrow({ where: { id: lot.id } })).quantity.toFixed(4), "5.0000");
    assert.deepEqual([await net(t, "INVENTORY_LOSS"), await onHand(t, product.id)], [15, "5.0000"]);
    const tooMany = await writeOffExpiry({ ...who(t), ...key(), batchId: lot.id, quantity: "6" });
    assert.equal(tooMany.ok, false);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("take-off: own use is a drawing, a sample is an expense, a chosen account is used, all at the average (D1)", async () => {
  await withTestOrg(async (t) => {
    const product = await withStock(t, "20", "6.0000");
    const take = (purpose: string, extra: Record<string, unknown> = {}) =>
      postTakeOff({ ...who(t), ...key(), businessDate: today(), purpose, recipient: "Field team", approvedBy: "Owner", note: "n", lines: [{ productId: product.id, quantity: "2" }], ...extra } as Parameters<typeof postTakeOff>[0]);
    assert.equal((await take("OWN_USE")).ok, true);
    assert.equal(await net(t, "DRAWINGS"), 12);
    assert.equal((await take("SAMPLE")).ok, true);
    assert.equal(await net(t, "MISC"), 12);
    const account = await prisma.account.create({ data: { organizationId: t.org.id, groupId: (await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, roles: { some: { role: "MISC" } } } })).groupId, code: "6777", name: "Marketing", kind: "OTHER" } });
    assert.equal((await take("DEMO", { expenseAccountId: account.id })).ok, true);
    assert.equal(Number((await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, accountId: account.id }, _sum: { debit: true } }))._sum.debit), 12);
    assert.equal(await onHand(t, product.id), "14.0000");
    const header = await prisma.stockDocument.findFirstOrThrow({ where: { organizationId: t.org.id, type: "TAKE_OFF", takeOffPurpose: "OWN_USE" } });
    assert.deepEqual([header.recipient, header.approvedBy], ["Field team", "Owner"]);
    const ledger = await prisma.stockLedger.count({ where: { organizationId: t.org.id, movementType: "TAKE_OFF" } });
    assert.equal(ledger, 3);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a take-off of more than is on hand is refused and leaves nothing behind", async () => {
  await withTestOrg(async (t) => {
    const product = await withStock(t, "3", "6.0000");
    const journals = await prisma.journal.count({ where: { organizationId: t.org.id } });
    const refused = await postTakeOff({ ...who(t), ...key(), businessDate: today(), purpose: "GIFT", recipient: "x", approvedBy: "y", lines: [{ productId: product.id, quantity: "4" }] } as Parameters<typeof postTakeOff>[0]);
    assert.equal(refused.ok, false);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), journals);
    assert.equal(await prisma.stockDocument.count({ where: { organizationId: t.org.id, type: "TAKE_OFF" } }), 0);
    assert.equal(await onHand(t, product.id), "3.0000");
  });
});

test("the same request twice is one document: the stock moves once", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    const request = { ...who(t), idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId: product.id, quantity: "5", unitCost: "2" }] };
    const first = await postOpeningStock(request);
    const second = await postOpeningStock(request);
    assert.deepEqual([first.ok, second.ok, second.ok && second.replayed, first.ok && second.ok && first.id === second.id], [true, true, true, true]);
    assert.equal(await onHand(t, product.id), "5.0000");
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), 1);
  });
});

test("a locked period refuses the document and the stock does not move", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product();
    await prisma.organization.update({ where: { id: t.org.id }, data: { lockedThrough: new Date(`${today()}T00:00:00.000Z`) } });
    const refused = await postOpeningStock({ ...who(t), ...key(), businessDate: today(), lines: [{ productId: product.id, quantity: "5", unitCost: "2" }] });
    assert.equal(refused.ok, false);
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: t.org.id } }), 0);
  });
});

async function secondBranch(t: T) {
  const branch = await prisma.branch.create({ data: { organizationId: t.org.id, name: "Second" } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: t.org.id, branchId: branch.id, name: "W2" } });
  return { branch, warehouse };
}

test("a transfer between branches moves the inventory account from one branch to the other at the average", async () => {
  await withTestOrg(async (t) => {
    const product = await withStock(t, "10", "6.0000");
    const other = await secondBranch(t);
    const done = await postTransfer({
      organizationId: t.org.id, userId: t.owner.id, fromBranchId: t.branch.id, toBranchId: other.branch.id, fromWarehouseId: t.warehouse.id, toWarehouseId: other.warehouse.id,
      lines: [{ productId: product.id, quantity: "4" }], ...key(), ip: "127.0.0.1", userAgent: "test",
    });
    assert.equal(done.ok, true, JSON.stringify(done));
    const byBranch = async (branchId: string) => Number((await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, branchId, account: { roles: { some: { role: "INVENTORY" } } } }, _sum: { debit: true, credit: true } }))._sum.debit ?? 0) - Number((await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, branchId, account: { roles: { some: { role: "INVENTORY" } } } }, _sum: { credit: true } }))._sum.credit ?? 0);
    assert.equal(await byBranch(t.branch.id), 36);
    assert.equal(await byBranch(other.branch.id), 24);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a transfer between two warehouses of one branch changes no account, so it has no journal", async () => {
  await withTestOrg(async (t) => {
    const product = await withStock(t, "10", "6.0000");
    const w2 = await prisma.warehouse.create({ data: { organizationId: t.org.id, branchId: t.branch.id, name: "W2" } });
    const journals = await prisma.journal.count({ where: { organizationId: t.org.id } });
    const done = await postTransfer({
      organizationId: t.org.id, userId: t.owner.id, fromBranchId: t.branch.id, toBranchId: t.branch.id, fromWarehouseId: t.warehouse.id, toWarehouseId: w2.id,
      lines: [{ productId: product.id, quantity: "4" }], ...key(), ip: "127.0.0.1", userAgent: "test",
    });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), journals);
    assert.equal(await onHand(t, product.id), "10.0000");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("opening, a sale, damage, take-off and an adjustment together: the inventory account equals stock x average cost", async () => {
  await withTestOrg(async (t) => {
    const product = await withStock(t, "50", "6.3333");
    const sold = await postSale({ ...who(t), ...key(), businessDate: today(), lines: [{ productId: product.id, quantity: "7" }], paymentAmount: "70.00", paymentMethod: "CASH" });
    assert.equal(sold.ok, true, JSON.stringify(sold));
    assert.equal((await postDamage({ ...who(t), ...key(), productId: product.id, businessDate: today(), place: "x", purchasePrice: "1.00", salePrice: "1.00", discountAmount: "0.00", vatAmount: "0.00", quantity: "3", reason: "r" })).ok, true);
    assert.equal((await postTakeOff({ ...who(t), ...key(), businessDate: today(), purpose: "SAMPLE", recipient: "r", approvedBy: "a", lines: [{ productId: product.id, quantity: "5" }] } as Parameters<typeof postTakeOff>[0])).ok, true);
    assert.equal((await postAdjustment({ ...who(t), ...key(), productId: product.id, quantity: "2", direction: "OUT", reason: "count" })).ok, true);
    assert.equal(await onHand(t, product.id), "33.0000");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
