import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { allocateByWeight, costPurchase, type CostLine } from "./costing.ts";

// P05 task 2 (D2, D3): what a purchase costs. A line's discount, the header discount shared out over the lines, VAT (part of the cost,
// D2), then the haulage and other costs shared out by value (D3) give each line a landed unit cost to four decimals; the cents always add
// up exactly to what the vendor is owed and what the haulage cost.

const d = (value: string) => new Prisma.Decimal(value);
const line = (quantity: string, unitCost: string, discount = "0", vatRate = "0"): CostLine => ({ quantity: d(quantity), unitCost: d(unitCost), discount: d(discount), vatRate: d(vatRate) });
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), d("0"));

test("allocateByWeight: the shares add up to exactly the total, cents go to the largest remainders", () => {
  assert.deepEqual(allocateByWeight(d("10.00"), [d("1"), d("1"), d("1")]).map((x) => x.toFixed(2)), ["3.34", "3.33", "3.33"]);
  assert.deepEqual(allocateByWeight(d("100.00"), [d("50"), d("30"), d("20")]).map((x) => x.toFixed(2)), ["50.00", "30.00", "20.00"]);
  assert.deepEqual(allocateByWeight(d("0.05"), [d("1"), d("1"), d("1")]).map((x) => x.toFixed(2)), ["0.02", "0.02", "0.01"]);
  assert.deepEqual(allocateByWeight(d("5.00"), [d("0"), d("0")]).map((x) => x.toFixed(2)), ["5.00", "0.00"], "no weights: the first line takes it");
  assert.deepEqual(allocateByWeight(d("0"), [d("3"), d("4")]).map((x) => x.toFixed(2)), ["0.00", "0.00"]);
  assert.deepEqual(allocateByWeight(d("7.00"), [d("1")]).map((x) => x.toFixed(2)), ["7.00"]);
  for (const total of ["99.99", "1234.56", "0.01"]) {
    const shares = allocateByWeight(d(total), [d("333.33"), d("12.5"), d("7777"), d("0.01")]);
    assert.equal(sum(shares).toFixed(2), d(total).toFixed(2), total);
    assert.ok(shares.every((share) => share.gte(0)));
  }
});

test("three lines, a line discount, a header discount, VAT and haulage: the landed cost adds up to the bill plus the haulage", () => {
  const costing = costPurchase({
    lines: [line("10", "100.00", "50.00", "5"), line("20", "40.00", "0", "0"), line("5", "300.00", "100.00", "15")],
    headerDiscount: d("90.00"),
    transportCost: d("300.00"),
    otherCost: d("60.00"),
  });
  // gross 1000 + 800 + 1500 = 3300; line discounts 150 -> 3150; header discount 90 -> 3060 taxable
  assert.equal(costing.subtotal.toFixed(2), "3300.00");
  assert.equal(costing.lineDiscounts.toFixed(2), "150.00");
  assert.equal(costing.headerDiscount.toFixed(2), "90.00");
  assert.equal(costing.discountTotal.toFixed(2), "240.00");
  assert.equal(sum(costing.lines.map((l) => l.taxable)).toFixed(2), "3060.00");
  // what the vendor is owed: taxable + VAT; the haulage is paid to someone else
  assert.equal(costing.total.toFixed(2), sum(costing.lines.map((l) => l.taxable.plus(l.vat))).toFixed(2));
  assert.equal(costing.landedTotal.toFixed(2), costing.total.plus(360).toFixed(2));
  assert.equal(sum(costing.lines.map((l) => l.landedTotal)).toFixed(2), costing.landedTotal.toFixed(2), "the lines carry exactly bill + haulage");
  assert.equal(sum(costing.lines.map((l) => l.extra)).toFixed(2), "360.00");
  assert.equal(sum(costing.lines.map((l) => l.headerShare)).toFixed(2), "90.00");
});

test("the landed unit cost has four decimals and times the quantity gives the line back to within the fourth decimal", () => {
  const costing = costPurchase({ lines: [line("3", "10.00"), line("7", "3.00")], headerDiscount: d("1.00"), transportCost: d("10.00"), otherCost: d("0") });
  for (const l of costing.lines) {
    assert.equal(l.landedUnitCost.decimalPlaces() <= 4, true);
    const gap = l.landedUnitCost.mul(l.quantity).minus(l.landedTotal).abs();
    assert.ok(gap.lte(d("0.00005").mul(l.quantity)), `line off by ${gap.toString()}`);
  }
});

test("a purchase with no discount, VAT or haulage costs exactly what it says", () => {
  const costing = costPurchase({ lines: [line("10", "6.00"), line("4", "2.50")], headerDiscount: d("0"), transportCost: d("0"), otherCost: d("0") });
  assert.deepEqual([costing.total.toFixed(2), costing.landedTotal.toFixed(2)], ["70.00", "70.00"]);
  assert.deepEqual(costing.lines.map((l) => l.landedUnitCost.toFixed(4)), ["6.0000", "2.5000"]);
});

test("VAT is rounded to the cent per line and is part of the cost (D2)", () => {
  const costing = costPurchase({ lines: [line("3", "33.33", "0", "5")], headerDiscount: d("0"), transportCost: d("0"), otherCost: d("0") });
  // 99.99 x 5% = 4.9995 -> 5.00
  assert.deepEqual([costing.lines[0].vat.toFixed(2), costing.total.toFixed(2), costing.lines[0].landedTotal.toFixed(2)], ["5.00", "104.99", "104.99"]);
  assert.equal(costing.lines[0].landedUnitCost.toFixed(4), "34.9967");
});

test("the haulage is shared by value: the dearer line carries more of it", () => {
  const costing = costPurchase({ lines: [line("1", "100.00"), line("1", "300.00")], headerDiscount: d("0"), transportCost: d("40.00"), otherCost: d("0") });
  assert.deepEqual(costing.lines.map((l) => l.extra.toFixed(2)), ["10.00", "30.00"]);
});

test("what cannot be: a discount above the line, a header discount above the goods, a negative figure, no lines", () => {
  assert.throws(() => costPurchase({ lines: [line("1", "10.00", "11.00")], headerDiscount: d("0"), transportCost: d("0"), otherCost: d("0") }), /discount/i);
  assert.throws(() => costPurchase({ lines: [line("1", "10.00")], headerDiscount: d("10.01"), transportCost: d("0"), otherCost: d("0") }), /discount/i);
  assert.throws(() => costPurchase({ lines: [line("1", "10.00")], headerDiscount: d("0"), transportCost: d("-1"), otherCost: d("0") }), /negative|cost/i);
  assert.throws(() => costPurchase({ lines: [line("0", "10.00")], headerDiscount: d("0"), transportCost: d("0"), otherCost: d("0") }), /quantity/i);
  assert.throws(() => costPurchase({ lines: [], headerDiscount: d("0"), transportCost: d("0"), otherCost: d("0") }), /line/i);
  assert.throws(() => costPurchase({ lines: [line("1", "10.00", "0", "101")], headerDiscount: d("0"), transportCost: d("0"), otherCost: d("0") }), /VAT/i);
});

test("a free line (everything discounted) is allowed and carries no cost of its own, only a share of the haulage", () => {
  const costing = costPurchase({ lines: [line("2", "10.00", "20.00"), line("1", "50.00")], headerDiscount: d("0"), transportCost: d("10.00"), otherCost: d("0") });
  assert.equal(costing.lines[0].taxable.toFixed(2), "0.00");
  assert.equal(costing.lines[0].extra.toFixed(2), "0.00");
  assert.equal(costing.lines[1].landedTotal.toFixed(2), "60.00");
});
