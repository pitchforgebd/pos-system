import { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { isKeyRace } from "@/core/idempotency";
import { parseMoney } from "@/core/money";

// What the purchasing documents share: who is acting, how a refusal is told to the caller, and how a typed amount is read.

export type Actor = {
  organizationId: string;
  branchId: string;
  userId: string;
  warehouseId?: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
};

export type Failure = { ok: false; status: 404 | 409 | 422; code: "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE"; message: string };

export function failure(error: unknown): Failure | null {
  if (error instanceof RuleError) {
    const code = error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return { ok: false, status: error.status, code, message: error.message };
  }
  if (isKeyRace(error)) {
    throw error;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false, status: 409, code: "CONFLICT", message: "That document number was already used. Try again." };
  }
  return null;
}

/** An amount of money typed in: up to two decimals, not negative. Empty or missing is zero. */
export function amountOf(value: string | undefined | null, what: string): Prisma.Decimal {
  if (value === undefined || value === null || value.trim() === "") {
    return new Prisma.Decimal(0);
  }
  const parsed = parseMoney(value.trim());
  if (!parsed || parsed.isNeg()) {
    throw new RuleError(`Enter ${what} with up to two decimals.`);
  }
  return parsed;
}

/** A unit cost typed in: up to four decimals, not negative. */
export function costOf(value: string | undefined | null): Prisma.Decimal {
  const text = (value ?? "").trim();
  if (!/^\d{1,14}(\.\d{1,4})?$/.test(text)) {
    throw new RuleError("Enter a unit cost with up to four decimals.");
  }
  return new Prisma.Decimal(text);
}

/** A percentage typed in: 0 to 100, up to two decimals. Empty is zero. */
export function percentOf(value: string | undefined | null): Prisma.Decimal {
  const text = (value ?? "").trim();
  if (text === "") {
    return new Prisma.Decimal(0);
  }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text) || Number(text) > 100) {
    throw new RuleError("A VAT rate is between 0 and 100 percent, with up to two decimals.");
  }
  return new Prisma.Decimal(text);
}
