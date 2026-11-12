import { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";

// What a purchase costs (P05 task 2). Pure arithmetic, no database. A line's discount comes off the line; the header discount is shared
// out over the lines by value; VAT is worked out on what is left and is part of the cost (D2); the haulage and other costs are shared out
// over the lines by value (D3). The cents always add up exactly: nothing is lost or invented by rounding.

const ZERO = new Prisma.Decimal(0);
const CENT = new Prisma.Decimal("0.01");
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type CostLine = {
  quantity: Prisma.Decimal;
  /** Up to four decimals. */
  unitCost: Prisma.Decimal;
  /** An amount, not a percentage. */
  discount: Prisma.Decimal;
  /** A percentage, 0 to 100. */
  vatRate: Prisma.Decimal;
};

export type CostedLine = {
  quantity: Prisma.Decimal;
  /** quantity x unit cost. */
  gross: Prisma.Decimal;
  /** gross less the line's discount. */
  lineNet: Prisma.Decimal;
  /** Its share of the header discount. */
  headerShare: Prisma.Decimal;
  /** lineNet less headerShare: what the vendor charges for the line before VAT. */
  taxable: Prisma.Decimal;
  vat: Prisma.Decimal;
  /** Its share of the haulage and other costs. */
  extra: Prisma.Decimal;
  /** taxable + vat + extra: what the line cost to bring in. */
  landedTotal: Prisma.Decimal;
  /** landedTotal / quantity, four decimals. */
  landedUnitCost: Prisma.Decimal;
};

export type Costing = {
  lines: CostedLine[];
  subtotal: Prisma.Decimal;
  lineDiscounts: Prisma.Decimal;
  headerDiscount: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  /** What the vendor is owed for the bill: the goods less discounts, plus VAT. The haulage is not in it. */
  total: Prisma.Decimal;
  transportCost: Prisma.Decimal;
  otherCost: Prisma.Decimal;
  /** total + haulage + other costs: what the whole purchase cost. */
  landedTotal: Prisma.Decimal;
};

/**
 * Shares `total` (money, cents) out in proportion to `weights`. The shares add up to exactly `total`: each gets its share rounded down
 * to the cent, then the cents left over go one each to the biggest remainders (the earlier line first on a tie). With no weight at all
 * the first line takes everything.
 */
export function allocateByWeight(total: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
  const shares = weights.map(() => ZERO);
  if (shares.length === 0 || total.isZero()) {
    return shares;
  }
  const weightSum = weights.reduce((sum, weight) => sum.plus(weight), ZERO);
  if (weightSum.lte(0)) {
    shares[0] = total;
    return shares;
  }
  const exact = weights.map((weight) => total.mul(weight).div(weightSum));
  const floors = exact.map((value) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN));
  let cents = total.minus(floors.reduce((sum, share) => sum.plus(share), ZERO)).div(CENT).toNumber();
  const order = exact
    .map((value, index) => ({ index, remainder: value.minus(floors[index]) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  const result = [...floors];
  for (const { index } of order) {
    if (cents <= 0) {
      break;
    }
    result[index] = result[index].plus(CENT);
    cents -= 1;
  }
  return result;
}

function refuse(message: string): never {
  throw new RuleError(message);
}

export function costPurchase(input: { lines: CostLine[]; headerDiscount: Prisma.Decimal; transportCost: Prisma.Decimal; otherCost: Prisma.Decimal }): Costing {
  if (input.lines.length === 0) {
    refuse("Add a line to the purchase.");
  }
  if (input.headerDiscount.isNeg() || input.transportCost.isNeg() || input.otherCost.isNeg()) {
    refuse("A discount or a cost cannot be negative.");
  }
  const gross: Prisma.Decimal[] = [];
  const lineNet: Prisma.Decimal[] = [];
  for (const line of input.lines) {
    if (line.quantity.lte(0)) {
      refuse("Enter a quantity greater than zero.");
    }
    if (line.unitCost.isNeg() || line.discount.isNeg()) {
      refuse("A cost or a discount cannot be negative.");
    }
    if (line.vatRate.isNeg() || line.vatRate.gt(100)) {
      refuse("A VAT rate is between 0 and 100 percent.");
    }
    const lineGross = money(line.quantity.mul(line.unitCost));
    if (line.discount.gt(lineGross)) {
      refuse("A line's discount cannot be more than the line.");
    }
    gross.push(lineGross);
    lineNet.push(lineGross.minus(line.discount));
  }
  const goods = lineNet.reduce((sum, value) => sum.plus(value), ZERO);
  if (input.headerDiscount.gt(goods)) {
    refuse("The discount cannot be more than the goods.");
  }
  const headerShares = allocateByWeight(input.headerDiscount, lineNet);
  const taxable = lineNet.map((value, index) => value.minus(headerShares[index]));
  const vat = input.lines.map((line, index) => money(taxable[index].mul(line.vatRate).div(100)));
  const landedValue = taxable.map((value, index) => value.plus(vat[index]));
  const extraShares = allocateByWeight(input.transportCost.plus(input.otherCost), landedValue);
  const lines: CostedLine[] = input.lines.map((line, index) => {
    const landedTotal = landedValue[index].plus(extraShares[index]);
    return {
      quantity: line.quantity,
      gross: gross[index],
      lineNet: lineNet[index],
      headerShare: headerShares[index],
      taxable: taxable[index],
      vat: vat[index],
      extra: extraShares[index],
      landedTotal,
      landedUnitCost: landedTotal.div(line.quantity).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
    };
  });
  const sum = (pick: (line: CostedLine) => Prisma.Decimal) => lines.reduce((total, line) => total.plus(pick(line)), ZERO);
  const lineDiscounts = input.lines.reduce((total, line) => total.plus(line.discount), ZERO);
  const total = sum((line) => line.taxable.plus(line.vat));
  return {
    lines,
    subtotal: sum((line) => line.gross),
    lineDiscounts,
    headerDiscount: input.headerDiscount,
    discountTotal: lineDiscounts.plus(input.headerDiscount),
    vatTotal: sum((line) => line.vat),
    total,
    transportCost: input.transportCost,
    otherCost: input.otherCost,
    landedTotal: total.plus(input.transportCost).plus(input.otherCost),
  };
}
