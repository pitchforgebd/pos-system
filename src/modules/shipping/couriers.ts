import { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { decimalString, parseMoney } from "@/core/money";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

// The couriers the shop sends parcels by (P07 task 2, D13). The list starts with the usual ones, the owner edits it; each has the Condition
// percentage it keeps of the cash it collects and what it charges to deliver, inside Dhaka and outside. A courier is a party of its own: what it owes the
// shop (the cash it collected and has not paid yet) is its balance in the books.

/** The couriers every new shop starts with (D13). Entries by hand: no outside service is called. */
export const STARTER_COURIERS = ["Steadfast", "Pathao", "RedX", "Sundarban", "SA Paribahan"] as const;

/** Gives the organization the usual couriers when it has none. Safe to call again. */
export async function ensureCouriers(organizationId: string) {
  if ((await prisma.courier.count({ where: { organizationId } })) > 0) {
    return;
  }
  await prisma.courier.createMany({ data: STARTER_COURIERS.map((name) => ({ organizationId, name })) });
}

export type CourierRow = {
  id: string;
  name: string;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  defaultConditionPercent: string;
  defaultDeliveryCharge: string;
  outsideDeliveryCharge: string;
  apiProvider: string | null;
};

export async function listCouriers(organizationId: string): Promise<CourierRow[]> {
  await ensureCouriers(organizationId);
  const rows = await prisma.courier.findMany({ where: { organizationId }, orderBy: [{ status: "asc" }, { name: "asc" }] });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    status: row.status,
    defaultConditionPercent: decimalString(row.defaultConditionPercent, 2),
    defaultDeliveryCharge: decimalString(row.defaultDeliveryCharge, 2),
    outsideDeliveryCharge: decimalString(row.outsideDeliveryCharge, 2),
    apiProvider: row.apiProvider,
  }));
}

export type CourierInput = {
  name: string;
  phone?: string;
  status?: "ACTIVE" | "INACTIVE";
  defaultConditionPercent?: string;
  defaultDeliveryCharge?: string;
  outsideDeliveryCharge?: string;
};

function read(input: CourierInput) {
  const name = input.name.trim();
  if (name.length < 2) {
    throw new RuleError("Enter the courier's name.");
  }
  const money = (value: string | undefined, what: string) => {
    const parsed = parseMoney((value ?? "0").trim() || "0");
    if (!parsed || parsed.isNeg()) {
      throw new RuleError(`Enter ${what} with up to two decimals.`);
    }
    return parsed;
  };
  const percentText = (input.defaultConditionPercent ?? "0").trim() || "0";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(percentText) || Number(percentText) > 100) {
    throw new RuleError("The condition charge is between 0 and 100 percent, with up to two decimals.");
  }
  return {
    name,
    phone: input.phone?.trim() || null,
    status: input.status ?? ("ACTIVE" as const),
    defaultConditionPercent: new Prisma.Decimal(percentText),
    defaultDeliveryCharge: money(input.defaultDeliveryCharge, "the delivery charge inside Dhaka"),
    outsideDeliveryCharge: money(input.outsideDeliveryCharge, "the delivery charge outside Dhaka"),
  };
}

type Who = { organizationId: string; userId: string; ip: string; userAgent: string | null };

export async function saveCourier(who: Who, input: CourierInput & { id?: string }) {
  try {
    const data = read(input);
    if (input.id) {
      const found = await prisma.courier.findFirst({ where: { id: input.id, organizationId: who.organizationId }, select: { id: true } });
      if (!found) {
        throw new RuleError("That record was not found.", 404);
      }
      await prisma.courier.update({ where: { id: input.id }, data });
    }
    const row = input.id ? { id: input.id } : await prisma.courier.create({ data: { organizationId: who.organizationId, ...data }, select: { id: true } });
    await writeAudit({ organizationId: who.organizationId, userId: who.userId, action: input.id ? "update" : "create", module: "couriers", entityType: "courier", entityId: row.id, ip: who.ip, userAgent: who.userAgent });
    return { ok: true as const, id: row.id };
  } catch (error) {
    if (error instanceof RuleError) {
      return { ok: false as const, status: error.status, code: error.status === 404 ? ("NOT_FOUND" as const) : ("BUSINESS_RULE" as const), message: error.message };
    }
    throw error;
  }
}
