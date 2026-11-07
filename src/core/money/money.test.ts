import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { allocate, decimalString, money, moneyText, parseMoney, parseQuantity, quantity, sum, unitCost, zero } from "./index.ts";

const D = (value: string | number) => new Prisma.Decimal(value);

test("money rounds to two decimals, half up (away from zero), and never goes through a float", () => {
  assert.equal(money(D("1.005")).toFixed(2), "1.01");
  assert.equal(money(D("2.675")).toFixed(2), "2.68");
  assert.equal(money(D("1.004")).toFixed(2), "1.00");
  assert.equal(money(D("-1.005")).toFixed(2), "-1.01");
  assert.equal(money(D("0.1").plus("0.2")).toFixed(2), "0.30");
  assert.equal(quantity(D("1.00005")).toFixed(4), "1.0001");
  assert.equal(unitCost(D("12.34565")).toFixed(4), "12.3457");
  assert.equal(zero().isZero(), true);
});

test("moneyText is the two-decimal string of a value that may be missing", () => {
  assert.equal(moneyText(D("12.345")), "12.35");
  assert.equal(moneyText(null), "0.00");
  assert.equal(moneyText(undefined), "0.00");
  assert.equal(moneyText(7), "7.00");
  assert.equal(decimalString("3", 4), "3.0000");
});

test("sum adds decimals exactly", () => {
  assert.equal(sum([D("0.1"), D("0.2"), D("0.3")]).toFixed(2), "0.60");
  assert.equal(sum([]).toFixed(2), "0.00");
});

test("parseMoney takes only a plain non-negative amount with at most two decimals", () => {
  for (const good of ["0", "10", "10.5", "10.55", "0.01", "1234567.89"]) {
    assert.equal(parseMoney(good)?.toFixed(2), D(good).toFixed(2), good);
  }
  for (const bad of ["", " 1", "1 ", "-1", "+1", "1e3", "1,000", "10.555", "01", "1.", ".5", "NaN", "Infinity", "০১"]) {
    assert.equal(parseMoney(bad), null, JSON.stringify(bad));
  }
});

test("parseQuantity takes a positive amount with at most four decimals", () => {
  assert.equal(parseQuantity("1")?.toFixed(4), "1.0000");
  assert.equal(parseQuantity("0.0001")?.toFixed(4), "0.0001");
  for (const bad of ["0", "0.0", "0.0000", "-1", "1.00001", "", "1e2", "01"]) {
    assert.equal(parseQuantity(bad), null, JSON.stringify(bad));
  }
});

test("allocate splits a total by weights so that the parts add up to the total exactly", () => {
  const text = (parts: Prisma.Decimal[]) => parts.map((part) => part.toFixed(2));
  assert.deepEqual(text(allocate(D("100.00"), [D(1), D(1), D(1)])), ["33.34", "33.33", "33.33"]);
  assert.deepEqual(text(allocate(D("10.00"), [D(1), D(2), D(3)])), ["1.67", "3.33", "5.00"]);
  assert.deepEqual(text(allocate(D("0.01"), [D(1), D(1)])), ["0.01", "0.00"]);
  assert.deepEqual(text(allocate(D("10.00"), [D(0), D(1)])), ["0.00", "10.00"]);
  assert.deepEqual(text(allocate(D("-10.00"), [D(1), D(1), D(1)])), ["-3.34", "-3.33", "-3.33"]);
  assert.deepEqual(text(allocate(D("0"), [D(1), D(2)])), ["0.00", "0.00"]);
  // the largest remainder gets the spare cent, not the first line
  assert.deepEqual(text(allocate(D("1.00"), [D("1.9"), D("1.1")])), ["0.63", "0.37"]);
  assert.deepEqual(allocate(D("5.0000"), [D(1), D(1), D(1)], 4).map((part) => part.toFixed(4)), ["1.6667", "1.6667", "1.6666"]);
});

test("allocate refuses weights that cannot share a total", () => {
  assert.throws(() => allocate(D("5.00"), []), RangeError);
  assert.throws(() => allocate(D("5.00"), [D(0), D(0)]), RangeError);
  assert.throws(() => allocate(D("5.00"), [D(1), D(-1)]), RangeError);
});

test("allocate: 500 random splits always add up to the total and stay within a cent of the exact share", () => {
  let seed = 20261108;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let round = 0; round < 500; round += 1) {
    const total = D((Math.floor(next() * 2_000_000) / 100).toFixed(2));
    const count = 1 + Math.floor(next() * 9);
    const weights = Array.from({ length: count }, () => D(1 + Math.floor(next() * 1000)).div(D(1 + Math.floor(next() * 7))));
    const parts = allocate(total, weights);
    assert.equal(sum(parts).toFixed(2), total.toFixed(2), `round ${round}`);
    const weightSum = sum(weights);
    parts.forEach((part, index) => {
      const exact = total.mul(weights[index]).div(weightSum);
      assert.equal(part.minus(exact).abs().lt(D("0.01")), true, `round ${round} line ${index}`);
      assert.equal(part.gte(0), true);
    });
  }
});
