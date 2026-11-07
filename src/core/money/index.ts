// Money and quantities. Everything is a Prisma.Decimal (decimal.js): never a JS number, so 0.1 + 0.2 is 0.3.
// Rounding is half up, away from zero. Amounts have 2 decimals, quantities and unit costs 4 (02_ACCOUNTING_MODEL §3).
import { Prisma } from "@prisma/client";

type Decimal = Prisma.Decimal;
type DecimalInput = Decimal | string | number;

export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 4;

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

export function zero(): Decimal {
  return new Prisma.Decimal(0);
}

/** An amount of money, rounded half up to 2 decimals. */
export function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(MONEY_SCALE, HALF_UP);
}

/** A quantity, rounded half up to 4 decimals. */
export function quantity(value: Decimal): Decimal {
  return value.toDecimalPlaces(QUANTITY_SCALE, HALF_UP);
}

/** A unit cost, rounded half up to 4 decimals. */
export function unitCost(value: Decimal): Decimal {
  return value.toDecimalPlaces(QUANTITY_SCALE, HALF_UP);
}

export function decimalString(value: DecimalInput, scale: number): string {
  return new Prisma.Decimal(value).toFixed(scale);
}

/** The two-decimal text of an amount that may be missing (a missing amount is 0.00). */
export function moneyText(value: DecimalInput | null | undefined): string {
  return decimalString(value ?? 0, MONEY_SCALE);
}

export function sum(values: Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), zero());
}

const moneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const quantityPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

/** A plain non-negative amount with at most two decimals, from text. Anything else is null. */
export function parseMoney(value: string): Decimal | null {
  return moneyPattern.test(value) ? new Prisma.Decimal(value) : null;
}

/** A positive quantity with at most four decimals, from text. Anything else (including 0) is null. */
export function parseQuantity(value: string): Decimal | null {
  if (!quantityPattern.test(value)) {
    return null;
  }
  const parsed = new Prisma.Decimal(value);
  return parsed.gt(0) ? parsed : null;
}

/**
 * Splits `total` over `weights` so that the parts add up to the total exactly (largest remainder method):
 * every part is rounded down to `scale` decimals, and the spare units go, one each, to the parts with the
 * largest remainder (the first one wins a tie). Used for invoice discounts, landed cost, VAT and refunds.
 */
export function allocate(total: Decimal, weights: Decimal[], scale: number = MONEY_SCALE): Decimal[] {
  if (weights.length === 0) {
    throw new RangeError("allocate needs at least one weight");
  }
  if (weights.some((weight) => weight.isNeg())) {
    throw new RangeError("allocate weights cannot be negative");
  }
  const weightSum = sum(weights);
  if (weightSum.isZero()) {
    throw new RangeError("allocate weights cannot all be zero");
  }
  const negative = total.isNeg();
  const amount = total.abs().toDecimalPlaces(scale, HALF_UP);
  const unit = new Prisma.Decimal(10).pow(-scale);
  const exact = weights.map((weight) => amount.mul(weight).div(weightSum));
  const parts = exact.map((value) => value.toDecimalPlaces(scale, Prisma.Decimal.ROUND_DOWN));
  const spare = amount.minus(sum(parts)).div(unit).toNumber();
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value.minus(parts[index]) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  for (let i = 0; i < spare; i += 1) {
    const { index } = byRemainder[i];
    parts[index] = parts[index].plus(unit);
  }
  return negative ? parts.map((part) => part.neg()) : parts;
}
