import { Prisma, type ChargeBearer } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { decimalString, money, parseMoney, zero } from "@/core/money";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

// What a bank or a mobile account takes on a payment (P08 task 2, feature 9, D7). Each such account has a percentage and a fixed part and says who
// bears it (the shop by default). The forms propose the charge from it (1.85% of 1000 is 18.50); the user may change it. A charge borne by the shop
// is an expense: 6600 Bank charges for a bank, 6610 Mobile banking charges for a mobile wallet. A charge the customer bears is not the shop's:
// the form says how much more the customer should send.

export type ChargeKind = "CASH" | "BANK" | "MOBILE";

/** The expense account role a charge on this kind of account goes to. */
export const chargeRole = (kind: ChargeKind) => (kind === "MOBILE" ? ("MOBILE_CHARGE" as const) : ("BANK_CHARGE" as const));

export type ChargeSuggestion = {
  kind: ChargeKind;
  percent: string;
  fixed: string;
  bearer: ChargeBearer;
  /** What the shop pays the bank or the service (0 when the customer bears it). */
  charge: string;
  /** What the customer should add on top (0 when the shop bears it). */
  customerPays: string;
};

export function chargeOf(rule: { percent: Prisma.Decimal; fixed: Prisma.Decimal }, amount: Prisma.Decimal) {
  return money(amount.mul(rule.percent).div(100).plus(rule.fixed));
}

/** The charge the forms propose for taking or paying `amount` through this account. A cash account has none. */
export async function suggestCharge(organizationId: string, accountId: string, amountText: string): Promise<ChargeSuggestion> {
  const amount = parseMoney(amountText);
  if (!amount || amount.isNeg()) {
    throw new RuleError("Enter an amount with up to two decimals.");
  }
  const account = await prisma.account.findFirst({ where: { id: accountId, organizationId }, select: { kind: true } });
  if (!account) {
    throw new RuleError("That record was not found.", 404);
  }
  const kind = account.kind as ChargeKind;
  const rule = kind === "CASH" ? null : await prisma.paymentMethodCharge.findUnique({ where: { organizationId_accountId: { organizationId, accountId } } });
  if (!rule) {
    return { kind, percent: "0.00", fixed: "0.00", bearer: "SHOP", charge: "0.00", customerPays: "0.00" };
  }
  const total = chargeOf(rule, amount);
  return {
    kind,
    percent: decimalString(rule.percent, 2),
    fixed: decimalString(rule.fixed, 2),
    bearer: rule.bearer,
    charge: rule.bearer === "SHOP" ? decimalString(total, 2) : "0.00",
    customerPays: rule.bearer === "CUSTOMER" ? decimalString(total, 2) : "0.00",
  };
}

/** The bank and mobile accounts with the charge rule each has (a missing rule shows as no charge). */
export async function listChargeRules(organizationId: string) {
  const accounts = await prisma.account.findMany({ where: { organizationId, status: "ACTIVE", kind: { in: ["BANK", "MOBILE"] } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, kind: true } });
  const rules = await prisma.paymentMethodCharge.findMany({ where: { organizationId } });
  const byAccount = new Map(rules.map((rule) => [rule.accountId, rule]));
  return accounts.map((account) => {
    const rule = byAccount.get(account.id);
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      kind: account.kind as "BANK" | "MOBILE",
      percent: decimalString(rule?.percent ?? zero(), 2),
      fixed: decimalString(rule?.fixed ?? zero(), 2),
      bearer: (rule?.bearer ?? "SHOP") as ChargeBearer,
    };
  });
}

export async function saveChargeRule(who: { organizationId: string; userId: string; ip: string; userAgent: string | null }, input: { accountId: string; percent: string; fixed: string; bearer: ChargeBearer }) {
  try {
    const account = await prisma.account.findFirst({ where: { id: input.accountId, organizationId: who.organizationId, kind: { in: ["BANK", "MOBILE"] } }, select: { id: true } });
    if (!account) {
      throw new RuleError("Only a bank or a mobile banking account has a charge.", 404);
    }
    const percentText = input.percent.trim() || "0";
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(percentText) || Number(percentText) > 100) {
      throw new RuleError("The charge percentage is between 0 and 100, with up to two decimals.");
    }
    const fixed = parseMoney(input.fixed.trim() || "0");
    if (!fixed || fixed.isNeg()) {
      throw new RuleError("Enter the fixed charge with up to two decimals.");
    }
    const data = { percent: new Prisma.Decimal(percentText), fixed, bearer: input.bearer };
    await prisma.paymentMethodCharge.upsert({ where: { organizationId_accountId: { organizationId: who.organizationId, accountId: input.accountId } }, create: { organizationId: who.organizationId, accountId: input.accountId, ...data }, update: data });
    await writeAudit({ organizationId: who.organizationId, userId: who.userId, action: "charge-rule", module: "settings", entityType: "account", entityId: input.accountId, after: { percent: percentText, fixed: input.fixed, bearer: input.bearer }, ip: who.ip, userAgent: who.userAgent });
    return { ok: true as const };
  } catch (error) {
    if (error instanceof RuleError) {
      return { ok: false as const, status: error.status, code: error.status === 404 ? ("NOT_FOUND" as const) : ("BUSINESS_RULE" as const), message: error.message };
    }
    throw error;
  }
}
