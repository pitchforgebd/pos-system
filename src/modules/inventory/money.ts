import { Prisma } from "@prisma/client";

const quantityPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const moneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function parseQuantity(value: string) {
  if (!quantityPattern.test(value) || value === "0" || value === "0.0" || value === "0.00" || value === "0.000" || value === "0.0000") {
    return null;
  }
  const quantity = new Prisma.Decimal(value);
  return quantity.gt(0) ? quantity : null;
}

export function parseMoney(value: string) {
  if (!moneyPattern.test(value)) {
    return null;
  }
  return new Prisma.Decimal(value);
}

export function decimalString(value: Prisma.Decimal | string | number, scale: number) {
  return new Prisma.Decimal(value).toFixed(scale);
}
