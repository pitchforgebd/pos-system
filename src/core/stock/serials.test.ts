import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { postOpeningStock } from "../../modules/inventory/documents.ts";
import { postSale } from "../../modules/sales/sales.ts";
import { concurrentlySettled, factories, withTestOrg } from "../../tests/helpers/index.ts";
import { assertBooksReconcile } from "../reconcile/index.ts";
import { businessDate as today } from "../time/business-date.ts";

// P03 task 7 (N4, L8, I13): an IMEI or serial number is added when the stock comes in, belongs to the warehouse it is in, and is
// sold once: the sale takes it with one conditional update, so two sales of the same unit cannot both succeed.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const who = (t: T, warehouseId = t.warehouse.id) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, warehouseId, ip: "127.0.0.1", userAgent: "test" });

async function phone(t: T, serials: string[], warehouseId = t.warehouse.id, existing?: string) {
  const product = existing ? await prisma.product.findUniqueOrThrow({ where: { id: existing } }) : await factories(t).product({ trackSerial: true, sellingPrice: "100.00", purchasePrice: "80.00", wholesalePrice: "100.00", minimumPrice: "50.00" });
  const done = await postOpeningStock({ ...who(t, warehouseId), idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId: product.id, quantity: String(serials.length), unitCost: "80.00", serials }] });
  assert.equal(done.ok, true, JSON.stringify(done));
  return product;
}

const sell = (t: T, productId: string, serial: string, warehouseId = t.warehouse.id) =>
  postSale({ ...who(t, warehouseId), idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId, quantity: "1", serial }], paymentAmount: "100.00", paymentMethod: "CASH" });

test("serials come in with the stock: each is IN_STOCK in its warehouse and points at the movement that brought it", async () => {
  await withTestOrg(async (t) => {
    const product = await phone(t, ["IMEI-1", "IMEI-2"]);
    const rows = await prisma.productSerial.findMany({ where: { organizationId: t.org.id }, orderBy: { serial: "asc" } });
    assert.deepEqual(rows.map((r) => [r.serial, r.status, r.warehouseId, r.productId]), [["IMEI-1", "IN_STOCK", t.warehouse.id, product.id], ["IMEI-2", "IN_STOCK", t.warehouse.id, product.id]]);
    const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.ok(rows.every((r) => r.inMovementId === ledger.id));
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a serial-tracked product needs exactly one serial for each unit, and a serial that already exists is refused; nothing is kept", async () => {
  await withTestOrg(async (t) => {
    const product = await phone(t, ["IMEI-1"]);
    const line = (quantity: string, serials: string[]) => ({ ...who(t), idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId: product.id, quantity, unitCost: "80.00", serials }] });
    assert.equal((await postOpeningStock(line("2", ["IMEI-A"]))).ok, false, "two units, one serial");
    assert.equal((await postOpeningStock(line("1", ["IMEI-A", "IMEI-B"]))).ok, false, "one unit, two serials");
    assert.equal((await postOpeningStock(line("1", ["IMEI-1"]))).ok, false, "that serial is already in the system");
    assert.equal((await postOpeningStock(line("1", []))).ok, false, "no serial at all");
    assert.equal(await prisma.productSerial.count({ where: { organizationId: t.org.id } }), 1);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: t.org.id } })).quantity.toFixed(4), "1.0000");
  });
});

test("a sale takes the serial: it is SOLD with the sale, and cannot be sold again", async () => {
  await withTestOrg(async (t) => {
    const product = await phone(t, ["IMEI-1", "IMEI-2"]);
    const first = await sell(t, product.id, "IMEI-1");
    assert.equal(first.ok, true, JSON.stringify(first));
    const row = await prisma.productSerial.findFirstOrThrow({ where: { organizationId: t.org.id, serial: "IMEI-1" } });
    assert.deepEqual([row.status, row.saleId], ["SOLD", first.ok ? first.id : null]);
    assert.equal((await sell(t, product.id, "IMEI-1")).ok, false);
    assert.equal((await sell(t, product.id, "NOT-THERE")).ok, false);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("two sales of the same IMEI at the same moment: exactly one succeeds (I13)", async () => {
  await withTestOrg(async (t) => {
    const product = await phone(t, ["IMEI-1", "IMEI-2"]);
    const results = await concurrentlySettled(2, () => sell(t, product.id, "IMEI-1"));
    const oks = results.map((r) => (r.status === "fulfilled" && r.value.ok ? 1 : 0));
    assert.equal(oks.reduce<number>((a, b) => a + b, 0), 1);
    assert.equal(await prisma.productSerial.count({ where: { organizationId: t.org.id, status: "SOLD" } }), 1);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: t.org.id } })).quantity.toFixed(4), "1.0000", "the losing sale moved no stock");
  });
});

test("a serial in one warehouse cannot be sold from another", async () => {
  await withTestOrg(async (t) => {
    const other = await prisma.warehouse.create({ data: { organizationId: t.org.id, branchId: t.branch.id, name: "W2" } });
    const product = await phone(t, ["IMEI-A"], t.warehouse.id);
    await phone(t, ["IMEI-B"], other.id, product.id);
    const wrong = await sell(t, product.id, "IMEI-A", other.id);
    assert.equal(wrong.ok, false, "IMEI-A is in the first warehouse");
    assert.equal((await sell(t, product.id, "IMEI-B", other.id)).ok, true);
    assert.equal((await sell(t, product.id, "IMEI-A", t.warehouse.id)).ok, true);
  });
});
