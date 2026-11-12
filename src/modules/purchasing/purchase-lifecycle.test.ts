import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { partyBalance } from "../../core/parties/index.ts";
import { billPayment } from "../../core/payments/index.ts";
import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { cancelPurchase, getPurchase, orderPurchase, postPurchase, receivePurchase, saveDraftPurchase, updatePurchase, type PurchaseInput } from "./purchases.ts";
import { postSupplierPayment } from "./purchases.ts";

// P05 tasks 1-4: a purchase is written down (DRAFT), sent to the vendor (ORDERED, nothing posted), received (the stock comes in at its
// landed cost and the books are posted together) or cancelled before it was received. The golden case is worked out by hand below.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T, key = randomUUID()) => ({ ...t.actor, idempotencyKey: key });

/**
 * Three lines, a 10% header discount, 5% VAT, and 311.85 of haulage and labour: every figure divides exactly, so the hand calculation is
 * the whole answer.
 *   gross      A 10 x 100.00 = 1000.00   B 20 x 40.00 = 800.00   C 5 x 300.00 = 1500.00      = 3300.00
 *   header 10% A -100.00                 B  -80.00                C -150.00                   = -330.00
 *   taxable    A  900.00                 B  720.00                C 1350.00                   = 2970.00
 *   VAT 5%     A   45.00                 B   36.00                C   67.50                   =  148.50
 *   the bill   A  945.00                 B  756.00                C 1417.50                   = 3118.50  (owed to the vendor)
 *   haulage    A   94.50                 B   75.60                C  141.75                   =  311.85  (250.00 haulage + 61.85 labour)
 *   landed     A 1039.50 (103.9500 each) B 831.60 (41.5800 each)  C 1559.25 (311.8500 each)    = 3430.35
 */
async function golden(t: T, overrides: Partial<PurchaseInput> = {}) {
  const f = factories(t);
  const [a, b, c] = [await f.product({ name: "A" }), await f.product({ name: "B" }), await f.product({ name: "C" })];
  const vendor = await f.vendor({ name: "Seed Mill" });
  const input: PurchaseInput = {
    supplierId: vendor.id,
    businessDate: "2026-11-01",
    supplierInvoiceNo: "INV-77",
    headerDiscount: "330.00",
    transportCost: "250.00",
    otherCost: "61.85",
    transportPaidWith: "CASH",
    lines: [
      { productId: a.id, quantity: "10", unitCost: "100.00", vatRate: "5" },
      { productId: b.id, quantity: "20", unitCost: "40.00", vatRate: "5" },
      { productId: c.id, quantity: "5", unitCost: "300.00", vatRate: "5" },
    ],
    ...overrides,
  };
  return { f, products: [a, b, c], vendor, input };
}

const journalLines = async (t: T, purchaseId: string) =>
  (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "PURCHASE", docId: purchaseId } }, include: { account: { include: { roles: true } } } }))
    .map((l) => ({ role: l.account.roles.map((r) => r.role).join(","), party: l.partyId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2) }))
    .sort((x, y) => x.role.localeCompare(y.role) || Number(y.credit) - Number(x.credit));

const stockOf = (t: T, productId: string) => prisma.stockBalance.findFirst({ where: { organizationId: t.org.id, productId } });
const movements = (t: T) => prisma.stockLedger.count({ where: { organizationId: t.org.id, movementType: "PURCHASE" } });

test("golden case: received with the haulage paid in cash, every figure is the hand calculation", async () => {
  await withTestOrg(async (t) => {
    const { products, vendor, input } = await golden(t);
    const done = await postPurchase({ ...actor(t), ...input });
    assert.equal(done.ok, true, JSON.stringify(done));
    if (!done.ok) {
      return;
    }
    const purchase = await getPurchase(t.org.id, t.branch.id, done.id);
    assert.ok(purchase);
    assert.deepEqual(
      [purchase.status, purchase.subtotal, purchase.discountTotal, purchase.vatTotal, purchase.total, purchase.chargesTotal, purchase.landedTotal],
      ["RECEIVED", "3300.00", "330.00", "148.50", "3118.50", "311.85", "3430.35"],
    );
    assert.deepEqual(purchase.items.map((item) => [item.lineTotal, item.landedUnitCost]), [["945.00", "103.9500"], ["756.00", "41.5800"], ["1417.50", "311.8500"]]);
    // the stock is in at the landed cost
    assert.deepEqual((await Promise.all(products.map((p) => stockOf(t, p.id)))).map((s) => [s?.quantity.toFixed(4), s?.averageCost?.toFixed(4)]), [["10.0000", "103.9500"], ["20.0000", "41.5800"], ["5.0000", "311.8500"]]);
    // one journal: the goods in, the vendor owed the bill, the haulage out of the till
    assert.deepEqual(await journalLines(t, done.id), [
      { role: "AP", party: vendor.id, debit: "0.00", credit: "3118.50" },
      { role: "CASH", party: null, debit: "0.00", credit: "311.85" },
      { role: "INVENTORY", party: null, debit: "3430.35", credit: "0.00" },
    ]);
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "VENDOR", partyId: vendor.id })).toFixed(2), "3118.50");
    assert.equal((await billPayment(prisma, t.org.id, done.id)).owed.toFixed(2), "3118.50");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the haulage on the carrier's credit: the carrier is owed it, the vendor's bill does not include it", async () => {
  await withTestOrg(async (t) => {
    const { f, vendor, input } = await golden(t);
    const carrier = await f.vendor({ name: "Fast Trucks" });
    const done = await postPurchase({ ...actor(t), ...input, transporterId: carrier.id, transportPaidWith: "CREDIT", vehicleNo: "DHAKA-METRO-11" });
    assert.equal(done.ok, true, JSON.stringify(done));
    if (!done.ok) {
      return;
    }
    assert.deepEqual(await journalLines(t, done.id), [
      { role: "AP", party: vendor.id, debit: "0.00", credit: "3118.50" },
      { role: "AP", party: carrier.id, debit: "0.00", credit: "311.85" },
      { role: "INVENTORY", party: null, debit: "3430.35", credit: "0.00" },
    ]);
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "VENDOR", partyId: vendor.id })).toFixed(2), "3118.50");
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "VENDOR", partyId: carrier.id })).toFixed(2), "311.85");
    const bill = await billPayment(prisma, t.org.id, done.id);
    assert.deepEqual([bill.status, bill.owed.toFixed(2)], ["UNPAID", "3118.50"], "the bill is the vendor's, the carrier's 311.85 is not on it");
    // paying the vendor all of it settles the bill; the carrier is still owed
    const paid = await postSupplierPayment({ ...actor(t), supplierId: vendor.id, businessDate: "2026-11-02", amount: "3118.50", method: "CASH" });
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.equal((await billPayment(prisma, t.org.id, done.id)).status, "PAID");
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "VENDOR", partyId: carrier.id })).toFixed(2), "311.85");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("draft and ordered purchases post nothing; the number comes when it is ordered; it can be changed until received", async () => {
  await withTestOrg(async (t) => {
    const { products, input } = await golden(t);
    const draft = await saveDraftPurchase(actor(t), input);
    assert.equal(draft.ok, true, JSON.stringify(draft));
    if (!draft.ok) {
      return;
    }
    assert.deepEqual([draft.status, draft.number], ["DRAFT", null]);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id, docType: "PURCHASE" } }), 0);
    assert.equal(await movements(t), 0);

    const changed = await updatePurchase(actor(t), draft.id, { ...input, lines: [{ ...input.lines[0], quantity: "12" }] });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    assert.equal((await getPurchase(t.org.id, t.branch.id, draft.id))?.items.length, 1);

    const ordered = await orderPurchase(actor(t), draft.id);
    assert.equal(ordered.ok, true, JSON.stringify(ordered));
    assert.ok(ordered.ok && ordered.number?.startsWith("PUR"), "the order takes the PUR number");
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id, docType: "PURCHASE" } }), 0);
    assert.equal(await movements(t), 0);
    assert.equal((await orderPurchase(actor(t), draft.id)).ok, false, "ordered twice");

    const again = await updatePurchase(actor(t), draft.id, input);
    assert.equal(again.ok, true, "an ordered purchase can still be changed (the vendor changed the offer)");
    const received = await receivePurchase(actor(t), draft.id, { receivedOn: "2026-11-03" });
    assert.equal(received.ok, true, JSON.stringify(received));
    assert.equal((await stockOf(t, products[0].id))?.quantity.toFixed(4), "10.0000");
    const after = await getPurchase(t.org.id, t.branch.id, draft.id);
    assert.deepEqual([after?.status, after?.receivedOn, after?.number], ["RECEIVED", "2026-11-03", ordered.ok ? ordered.number : null]);
    const stocked = await prisma.stockLedger.findFirstOrThrow({ where: { organizationId: t.org.id, movementType: "PURCHASE" } });
    assert.equal(stocked.businessDate.toISOString().slice(0, 10), "2026-11-03", "the stock and the journal are dated by the day the goods came");
    assert.equal((await updatePurchase(actor(t), draft.id, input)).ok, false, "a received purchase cannot be changed");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("cancelling: before it was received; a received purchase is undone by a return, not a cancel", async () => {
  await withTestOrg(async (t) => {
    const { input } = await golden(t);
    const draft = await saveDraftPurchase(actor(t), input);
    assert.ok(draft.ok);
    const cancelled = await cancelPurchase(actor(t), draft.ok ? draft.id : "");
    assert.equal(cancelled.ok && cancelled.status, "CANCELLED");
    assert.equal((await receivePurchase(actor(t), draft.ok ? draft.id : "")).ok, false, "a cancelled purchase cannot be received");
    assert.equal((await cancelPurchase(actor(t), draft.ok ? draft.id : "")).ok, false, "cancelled twice");
    assert.equal(await movements(t), 0);

    const bought = await postPurchase({ ...actor(t), ...input });
    assert.ok(bought.ok);
    const refused = await cancelPurchase(actor(t), bought.ok ? bought.id : "");
    assert.equal(refused.ok, false);
    assert.equal(!refused.ok && refused.status, 409);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("received twice, with the same key or another: the stock comes in once", async () => {
  await withTestOrg(async (t) => {
    const { products, input } = await golden(t);
    const draft = await saveDraftPurchase(actor(t), input);
    assert.ok(draft.ok);
    const id = draft.ok ? draft.id : "";
    const key = randomUUID();
    const first = await receivePurchase(actor(t, key), id, { receivedOn: "2026-11-02" });
    const replay = await receivePurchase(actor(t, key), id, { receivedOn: "2026-11-02" });
    assert.deepEqual([first.ok, replay.ok, replay.ok && replay.replayed], [true, true, true]);
    const other = await receivePurchase(actor(t), id, { receivedOn: "2026-11-02" });
    assert.equal(other.ok, false);
    assert.equal(!other.ok && other.status, 409);
    assert.equal(await movements(t), 3, "three lines, once");
    assert.equal((await stockOf(t, products[1].id))?.quantity.toFixed(4), "20.0000");
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id, docType: "PURCHASE" } }), 1);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("paid in part when it is received: the bill is PARTIAL; more than the bill is refused; nothing is half done", async () => {
  await withTestOrg(async (t) => {
    const { input, vendor } = await golden(t);
    const over = await postPurchase({ ...actor(t), ...input, paymentAmount: "3118.51", paymentMethod: "CASH" });
    assert.equal(over.ok, false);
    assert.equal(await movements(t), 0, "refused as a whole: no stock, no journal");
    assert.equal(await prisma.purchase.count({ where: { organizationId: t.org.id } }), 0);

    const part = await postPurchase({ ...actor(t), ...input, paymentAmount: "1000.00", paymentMethod: "CASH" });
    assert.equal(part.ok, true, JSON.stringify(part));
    const bill = await billPayment(prisma, t.org.id, part.ok ? part.id : "");
    assert.deepEqual([bill.status, bill.paidAtSale.toFixed(2), bill.owed.toFixed(2)], ["PARTIAL", "1000.00", "2118.50"]);
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "VENDOR", partyId: vendor.id })).toFixed(2), "2118.50");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("awkward cents: the landed cost is rounded to four decimals, the books still reconcile and the rounding is only cents", async () => {
  await withTestOrg(async (t) => {
    const f = factories(t);
    const vendor = await f.vendor();
    const products = [await f.product(), await f.product(), await f.product()];
    const done = await postPurchase({
      ...actor(t),
      supplierId: vendor.id,
      businessDate: "2026-11-01",
      headerDiscount: "13.37",
      transportCost: "100.01",
      otherCost: "7.77",
      transportPaidWith: "CASH",
      lines: [
        { productId: products[0].id, quantity: "3", unitCost: "33.33", vatRate: "7.5" },
        { productId: products[1].id, quantity: "7", unitCost: "12.345", discount: "1.11", vatRate: "5" },
        { productId: products[2].id, quantity: "0.3333", unitCost: "999.99" },
      ],
    });
    assert.equal(done.ok, true, JSON.stringify(done));
    const lines = await journalLines(t, done.ok ? done.id : "");
    const variance = lines.filter((l) => l.role === "PPV").reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0);
    assert.ok(Math.abs(variance) <= 0.03, `rounding variance ${variance}`);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
