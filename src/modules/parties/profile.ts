import type { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { prisma } from "@/lib/db/client";

// What a customer's and a vendor's record share (P10): a Bangladeshi phone number, the code the shop knows them by, where they are (division ->
// district -> upazila, D15) and their tags.

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * A Bangladeshi mobile number in its usual form (01XXXXXXXXX), from what was typed: +8801..., 8801..., 01..., with spaces or dashes. Null when it is
 * not one (11 digits, starting 013 to 019).
 */
export function normalizeBdPhone(text: string | null | undefined): string | null {
  const digits = (text ?? "").replace(/[\s()-]/g, "").replace(/^\+/, "");
  const local = digits.startsWith("880") ? `0${digits.slice(3)}` : digits;
  return /^01[3-9]\d{8}$/.test(local) ? local : null;
}

/** A phone field: empty is none; anything else must be a Bangladeshi mobile number. */
export function phoneOf(text: string | null | undefined, what = "phone number") {
  if (!text || text.trim() === "") {
    return null;
  }
  const phone = normalizeBdPhone(text);
  if (!phone) {
    throw new RuleError(`Enter the ${what} as a Bangladeshi mobile number (01XXXXXXXXX).`);
  }
  return phone;
}

const PREFIX = { CUSTOMER: "CUS", VENDOR: "VEN" } as const;

/** The next code (CUS-00001, VEN-00001) of the shop. The shop's row is locked so two new customers never get the same code. */
export async function nextPartyCode(tx: Prisma.TransactionClient, organizationId: string, kind: keyof typeof PREFIX) {
  const prefix = PREFIX[kind];
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
  const pattern = `^${prefix}-[0-9]+$`;
  const rows =
    kind === "CUSTOMER"
      ? await tx.$queryRaw<Array<{ n: bigint | number | null }>>`SELECT MAX(CAST(SUBSTRING(code, 5) AS UNSIGNED)) AS n FROM customers WHERE organizationId = ${organizationId} AND code REGEXP ${pattern}`
      : await tx.$queryRaw<Array<{ n: bigint | number | null }>>`SELECT MAX(CAST(SUBSTRING(code, 5) AS UNSIGNED)) AS n FROM suppliers WHERE organizationId = ${organizationId} AND code REGEXP ${pattern}`;
  const next = Number(rows[0]?.n ?? 0) + 1;
  return `${prefix}-${String(next).padStart(5, "0")}`;
}

/** The district must exist, and an upazila must be one of that district's. Returns the ids to store. */
export async function placeOf(db: Db, input: { districtId?: number | null; upazilaId?: number | null }, required: boolean) {
  const districtId = input.districtId ?? null;
  const upazilaId = input.upazilaId ?? null;
  if (districtId === null) {
    if (required) {
      throw new RuleError("Choose the district.");
    }
    if (upazilaId !== null) {
      throw new RuleError("Choose the district of the upazila.");
    }
    return { districtId: null, upazilaId: null };
  }
  const district = await db.district.findUnique({ where: { id: districtId }, select: { id: true } });
  if (!district) {
    throw new RuleError("That district is not in the list.");
  }
  if (upazilaId !== null) {
    const upazila = await db.upazila.findUnique({ where: { id: upazilaId }, select: { districtId: true } });
    if (!upazila || upazila.districtId !== districtId) {
      throw new RuleError("That upazila is not in the chosen district.");
    }
  }
  return { districtId, upazilaId };
}

/** Tags typed as "wholesale, rice, regular": trimmed, each once, joined back with ", ". */
export function tagsOf(text: string | null | undefined) {
  const tags = [...new Set((text ?? "").split(",").map((tag) => tag.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const joined = tags.join(", ");
  if (joined.length > 255) {
    throw new RuleError("The tags are too long (255 characters at most).");
  }
  return joined || null;
}

export function paymentDaysOf(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0 || value > 365) {
    throw new RuleError("The payment days are between 0 and 365.");
  }
  return value;
}

/** Who else in the shop has this phone number (a warning on the form, not a block). */
export async function samePhone(organizationId: string, kind: "CUSTOMER" | "VENDOR", phone: string | null, exceptId?: string) {
  if (!phone) {
    return [];
  }
  const where = { organizationId, OR: [{ phone }, { altPhone: phone }], ...(exceptId ? { id: { not: exceptId } } : {}) };
  const rows = kind === "CUSTOMER" ? await prisma.customer.findMany({ where, select: { id: true, code: true, name: true }, take: 5 }) : await prisma.supplier.findMany({ where, select: { id: true, code: true, name: true }, take: 5 });
  return rows;
}

// ---- the places ---------------------------------------------------------------------------------------------------------------------------

type Geography = {
  divisions: Array<{ id: number; name: string; bnName: string }>;
  districts: Array<{ id: number; divisionId: number; name: string; bnName: string }>;
  upazilas: Array<{ id: number; districtId: number; name: string; bnName: string }>;
};

const CACHE = Symbol.for("meridian.geography");
type Holder = { [CACHE]?: Promise<Geography> };

/** Divisions, districts and upazilas (reference data: read once per process). */
export function geography(): Promise<Geography> {
  const holder = globalThis as Holder;
  holder[CACHE] ??= (async () => ({
    divisions: await prisma.division.findMany({ orderBy: { name: "asc" } }),
    districts: await prisma.district.findMany({ orderBy: { name: "asc" } }),
    upazilas: await prisma.upazila.findMany({ orderBy: { name: "asc" } }),
  }))().catch((error: unknown) => {
    delete holder[CACHE];
    throw error;
  });
  return holder[CACHE];
}

/** "Upazila, District" (or just the district) for a list. */
export async function placeLabel(districtId: number | null, upazilaId: number | null) {
  if (districtId === null) {
    return null;
  }
  const geo = await geography();
  const district = geo.districts.find((row) => row.id === districtId);
  const upazila = upazilaId === null ? null : geo.upazilas.find((row) => row.id === upazilaId);
  return [upazila?.name, district?.name].filter(Boolean).join(", ") || null;
}
