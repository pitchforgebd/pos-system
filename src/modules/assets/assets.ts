import { randomUUID } from "node:crypto";

import { Prisma, type FixedAssetCategory } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { hashPayload } from "@/core/idempotency";
import { accountsFor } from "@/core/ledger/accounts";
import { decimalString, money, zero } from "@/core/money";
import { businessDate as today, dateOnly } from "@/core/time/business-date";
import { runTx } from "@/core/tx/run";
import { prisma } from "@/lib/db/client";
import { daysInMonth, occurredDate } from "@/lib/format/date";
import { postBalancedJournal } from "@/modules/accounting/post";
import { writeAudit } from "@/modules/auth/audit";
import { allocateNumber } from "@/modules/documents/numbers";
import { amountOf, failure, type Actor } from "@/modules/purchasing/common";
import { checkDate, checkMonth, moneyAccountOf, remember, replay } from "@/modules/treasury/common";

// Fixed assets (P09, feature 5, #36-#38, D8). An asset's cost is on Fixed Assets and what has been written off is on Accumulated Depreciation, on
// lines that carry the asset's id, so the register is read from the books. Buying: Dr Fixed Assets / Cr the money account or the vendor's payable.
// An asset the shop already had: Dr Fixed Assets (cost) / Cr Accumulated Depreciation (written off before) / Cr Opening Balance Equity. Each month,
// in one journal, straight line: Dr Depreciation / Cr Accumulated Depreciation, the rounding left over taken in the last month. Selling or writing
// off: Dr money (what came), Dr Accumulated Depreciation / Cr Fixed Assets (cost); a gain is Other income, a loss Miscellaneous.

export const CATEGORIES: ReadonlyArray<{ value: FixedAssetCategory; label: string }> = [
  { value: "VEHICLE", label: "Vehicle" },
  { value: "FURNITURE", label: "Furniture" },
  { value: "COMPUTER", label: "Computer" },
  { value: "WAREHOUSE_EQUIPMENT", label: "Warehouse equipment" },
  { value: "OTHER", label: "Other" },
];

const text = (value: Prisma.Decimal) => decimalString(value, 2);

// ---- months --------------------------------------------------------------------------------------------------------------------------------

const indexOf = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return year * 12 + number - 1;
};
const monthAt = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
/** YYYY-MM plus `count` months. */
export const addMonths = (month: string, count: number) => monthAt(indexOf(month) + count);
/** How many months from `from` to `to` (0 when they are the same month). */
export const monthsFrom = (from: string, to: string) => indexOf(to) - indexOf(from);
const lastDay = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(daysInMonth(year, number)).padStart(2, "0")}`;
};

// ---- the straight line ---------------------------------------------------------------------------------------------------------------------

export type Schedule = { cost: Prisma.Decimal; salvageValue: Prisma.Decimal; openingDepreciation: Prisma.Decimal; depreciationStartMonth: string; depreciationMonths: number };

/**
 * What `month` should write off, given what has been written off so far. Straight line: by the k-th month the asset should have written off the
 * opening amount plus k times the monthly figure; from the last month on, everything above the salvage value. A month that was missed is caught up
 * the next time; the cents of rounding go in the last month; after the last month nothing more.
 */
export function depreciationFor(asset: Schedule, accumulated: Prisma.Decimal, month: string): Prisma.Decimal {
  const depreciable = asset.cost.minus(asset.salvageValue);
  const k = monthsFrom(asset.depreciationStartMonth, month) + 1;
  if (k < 1 || depreciable.lte(0)) {
    return zero();
  }
  const months = Math.max(asset.depreciationMonths, 1);
  let target: Prisma.Decimal;
  if (k >= months) {
    target = depreciable;
  } else {
    const monthly = money(depreciable.minus(asset.openingDepreciation).div(months));
    target = Prisma.Decimal.min(asset.openingDepreciation.plus(monthly.mul(k)), depreciable);
  }
  const due = money(target.minus(accumulated));
  return due.gt(0) ? due : zero();
}

// ---- what the books say about each asset ----------------------------------------------------------------------------------------------------

type Db = Prisma.TransactionClient | typeof prisma;

/** Cost (Fixed Assets) and written off (Accumulated Depreciation) of each asset, from its journal lines. */
async function figuresOf(db: Db, organizationId: string, ids?: string[]) {
  if (ids && ids.length === 0) {
    return new Map<string, { cost: Prisma.Decimal; accumulated: Prisma.Decimal }>();
  }
  const rows = await db.$queryRaw<Array<{ assetId: string; role: string; net: Prisma.Decimal | null }>>`
    SELECT l.assetId AS assetId, r.role AS role, SUM(l.debit - l.credit) AS net
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role IN ('FIXED_ASSET', 'ACCUM_DEPR')
    WHERE l.organizationId = ${organizationId} AND l.assetId IS NOT NULL ${ids ? Prisma.sql`AND l.assetId IN (${Prisma.join(ids)})` : Prisma.empty}
    GROUP BY l.assetId, r.role
  `;
  const result = new Map<string, { cost: Prisma.Decimal; accumulated: Prisma.Decimal }>();
  for (const row of rows) {
    const entry = result.get(row.assetId) ?? { cost: zero(), accumulated: zero() };
    const net = new Prisma.Decimal(row.net ?? 0);
    if (row.role === "FIXED_ASSET") {
      entry.cost = net;
    } else {
      entry.accumulated = net.neg();
    }
    result.set(row.assetId, entry);
  }
  return result;
}

async function lockAsset(tx: Prisma.TransactionClient, organizationId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM fixed_assets WHERE id = ${id} AND organizationId = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) {
    throw new RuleError("That record was not found.", 404);
  }
  return tx.fixedAsset.findUniqueOrThrow({ where: { id } });
}

// ---- adding an asset ----------------------------------------------------------------------------------------------------------------------

export type AssetInput = {
  code?: string;
  name: string;
  category: FixedAssetCategory;
  purchaseDate: string;
  cost: string;
  salvageValue?: string;
  usefulLifeMonths: number;
  location?: string;
  note?: string;
};

function checkAsset(input: AssetInput) {
  const name = input.name.trim();
  if (!name || name.length > 191) {
    throw new RuleError("Give the asset a name.");
  }
  const date = checkDate(input.purchaseDate);
  if (date > today()) {
    throw new RuleError("The purchase date cannot be in the future.");
  }
  const cost = amountOf(input.cost, "the cost");
  if (cost.lte(0)) {
    throw new RuleError("Enter a cost greater than zero.");
  }
  const salvage = amountOf(input.salvageValue, "the value left at the end");
  if (salvage.gte(cost)) {
    throw new RuleError("The value left at the end must be less than the cost.");
  }
  if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths < 1 || input.usefulLifeMonths > 600) {
    throw new RuleError("The useful life is between 1 and 600 months.");
  }
  const code = input.code?.trim().toUpperCase() || null;
  if (code && !/^[A-Z0-9][A-Z0-9/-]{0,31}$/.test(code)) {
    throw new RuleError("An asset code is up to 32 letters, digits, dashes or slashes.");
  }
  return { name, date, cost, salvage, code, location: input.location?.trim().slice(0, 191) || null, note: input.note?.trim().slice(0, 255) || null };
}

/**
 * Buys an asset (#36): Dr Fixed Assets / Cr the cash, bank or mobile account it was paid from, or the vendor's payable when it is owed. It is
 * depreciated from the month it was bought, over its whole life.
 */
export async function buyAsset(input: Actor & AssetInput & { paidWith: "ACCOUNT" | "CREDIT"; moneyAccountId?: string; vendorId?: string }) {
  const requestHash = hashPayload({ kind: "buy", ...input, idempotencyKey: undefined, ip: undefined, userAgent: undefined });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, code: null as string | null, replayed: true };
      }
      const checked = checkAsset(input);
      const id = randomUUID();
      let credit: { accountId: string } | { role: "AP"; party: { type: "VENDOR"; id: string } };
      let paidWith: string;
      if (input.paidWith === "CREDIT") {
        const vendor = input.vendorId ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM suppliers WHERE id = ${input.vendorId} AND organizationId = ${input.organizationId} AND status = 'ACTIVE' FOR UPDATE` : [];
        if (vendor.length === 0) {
          throw new RuleError("Choose the vendor the asset is owed to.");
        }
        credit = { role: "AP", party: { type: "VENDOR", id: vendor[0].id } };
        paidWith = "CREDIT";
      } else {
        if (!input.moneyAccountId) {
          throw new RuleError("Choose the account the asset was paid from.");
        }
        const account = await moneyAccountOf(tx, input.organizationId, input.moneyAccountId);
        credit = { accountId: account.id };
        paidWith = account.kind;
      }
      const code = checked.code ?? (await allocateNumber(tx, { organizationId: input.organizationId, documentType: "AST", businessDate: checked.date }));
      await tx.fixedAsset.create({
        data: {
          id,
          organizationId: input.organizationId,
          branchId: input.branchId,
          code,
          name: checked.name,
          category: input.category,
          purchaseDate: occurredDate(checked.date),
          cost: checked.cost,
          salvageValue: checked.salvage,
          usefulLifeMonths: input.usefulLifeMonths,
          location: checked.location,
          note: checked.note,
          depreciationStartMonth: checked.date.slice(0, 7),
          depreciationMonths: input.usefulLifeMonths,
          paidWith,
          moneyAccountId: "accountId" in credit ? credit.accountId : null,
          vendorId: "party" in credit ? credit.party.id : null,
          createdById: input.userId,
        },
      });
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(checked.date),
        description: `Asset ${code}: ${checked.name}`,
        createdById: input.userId,
        doc: { type: "ASSET_PURCHASE", id },
        lines: [{ role: "FIXED_ASSET", debit: checked.cost, credit: zero(), assetId: id }, { ...credit, debit: zero(), credit: checked.cost }],
      });
      await tx.fixedAsset.update({ where: { id }, data: { journalId } });
      await remember(tx, { ...input, requestHash, entityType: "fixed_asset", entityId: id });
      return { id, code, replayed: false };
    });
    return await finish(input, data, "asset buy");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

/**
 * An asset the shop already had before it used the system: Dr Fixed Assets (its cost) / Cr Accumulated Depreciation (what was written off before) /
 * Cr Opening Balance Equity (what it is worth now). What is left above the salvage value is written off over the months of its life still to come,
 * from the month after `asOf`.
 */
export async function addOpeningAsset(input: Actor & AssetInput & { accumulated: string; asOf?: string }) {
  const requestHash = hashPayload({ kind: "opening", ...input, idempotencyKey: undefined, ip: undefined, userAgent: undefined });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, code: null as string | null, replayed: true };
      }
      const checked = checkAsset(input);
      const asOf = checkDate(input.asOf || today());
      if (asOf > today() || asOf < checked.date) {
        throw new RuleError("The opening date is between the purchase date and today.");
      }
      const accumulated = amountOf(input.accumulated, "what was written off before");
      if (accumulated.gt(checked.cost.minus(checked.salvage))) {
        throw new RuleError("What was written off before cannot be more than the cost less the value left at the end.");
      }
      const startMonth = addMonths(asOf.slice(0, 7), 1);
      const left = input.usefulLifeMonths - monthsFrom(checked.date.slice(0, 7), startMonth);
      const id = randomUUID();
      const code = checked.code ?? (await allocateNumber(tx, { organizationId: input.organizationId, documentType: "AST", businessDate: asOf }));
      await tx.fixedAsset.create({
        data: {
          id,
          organizationId: input.organizationId,
          branchId: input.branchId,
          code,
          name: checked.name,
          category: input.category,
          purchaseDate: occurredDate(checked.date),
          cost: checked.cost,
          salvageValue: checked.salvage,
          usefulLifeMonths: input.usefulLifeMonths,
          location: checked.location,
          note: checked.note,
          isOpening: true,
          openingDepreciation: accumulated,
          depreciationStartMonth: startMonth,
          depreciationMonths: Math.max(left, 1),
          paidWith: "OPENING",
          createdById: input.userId,
        },
      });
      const worth = checked.cost.minus(accumulated);
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(asOf),
        description: `Opening asset ${code}: ${checked.name}`,
        createdById: input.userId,
        doc: { type: "ASSET_OPENING", id },
        lines: [
          { role: "FIXED_ASSET", debit: checked.cost, credit: zero(), assetId: id },
          ...(accumulated.gt(0) ? [{ role: "ACCUM_DEPR" as const, debit: zero(), credit: accumulated, assetId: id }] : []),
          ...(worth.gt(0) ? [{ role: "OPENING_EQUITY" as const, debit: zero(), credit: worth }] : []),
        ],
      });
      await tx.fixedAsset.update({ where: { id }, data: { journalId } });
      await remember(tx, { ...input, requestHash, entityType: "fixed_asset", entityId: id });
      return { id, code, replayed: false };
    });
    return await finish(input, data, "asset opening");
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

async function finish(input: Actor, data: { id: string; code: string | null; replayed: boolean }, action: string) {
  if (!data.replayed) {
    await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action, module: "accounting", entityType: "fixed_asset", entityId: data.id, after: { code: data.code }, ip: input.ip, userAgent: input.userAgent });
  }
  return { ok: true as const, ...data };
}

// ---- depreciation -------------------------------------------------------------------------------------------------------------------------

/** What each active asset would write off in `month`, and what it would then be worth. */
export async function previewDepreciation(organizationId: string, month: string, db: Db = prisma) {
  checkMonth(month);
  const assets = await db.fixedAsset.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { code: "asc" } });
  const figures = await figuresOf(db, organizationId, assets.map((asset) => asset.id));
  const rows = assets.map((asset) => {
    const own = figures.get(asset.id) ?? { cost: zero(), accumulated: zero() };
    const amount = depreciationFor(asset, own.accumulated, month);
    return { id: asset.id, code: asset.code, name: asset.name, branchId: asset.branchId, cost: asset.cost, accumulated: own.accumulated, amount, bookValueAfter: asset.cost.minus(own.accumulated).minus(amount) };
  });
  const due = rows.filter((row) => row.amount.gt(0));
  const run = await db.depreciationRun.findUnique({ where: { organizationId_month: { organizationId, month } }, select: { id: true, journalId: true, total: true } });
  return {
    month,
    done: run ? { journalId: run.journalId, total: text(run.total) } : null,
    total: text(due.reduce((sum, row) => sum.plus(row.amount), zero())),
    rows: due.map((row) => ({ id: row.id, code: row.code, name: row.name, branchId: row.branchId, cost: text(row.cost), accumulated: text(row.accumulated), amount: row.amount, bookValueAfter: text(row.bookValueAfter) })),
  };
}

/**
 * Posts one month's depreciation (#37): one journal with a Depreciation and an Accumulated Depreciation line for each asset, dated the last day of
 * the month (today, for the month still running). Months go in order and each only once; a month in the future cannot be depreciated.
 */
export async function runDepreciation(input: Actor & { month: string }) {
  const requestHash = hashPayload({ depreciate: input.month });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, total: null as string | null, count: 0, replayed: true };
      }
      const month = checkMonth(input.month);
      const now = today();
      if (month > now.slice(0, 7)) {
        throw new RuleError("A month that has not started cannot be depreciated.");
      }
      // One run at a time for the shop: the organization row is the lock.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${input.organizationId} FOR UPDATE`;
      if (await tx.depreciationRun.findUnique({ where: { organizationId_month: { organizationId: input.organizationId, month } }, select: { id: true } })) {
        throw new RuleError(`${month} was already depreciated.`, 409);
      }
      const later = await tx.depreciationRun.findFirst({ where: { organizationId: input.organizationId, month: { gt: month } }, select: { month: true } });
      if (later) {
        throw new RuleError(`${later.month} is already depreciated: months are depreciated in order.`, 409);
      }
      await tx.$queryRaw`SELECT id FROM fixed_assets WHERE organizationId = ${input.organizationId} AND status = 'ACTIVE' FOR UPDATE`;
      const preview = await previewDepreciation(input.organizationId, month, tx);
      if (preview.rows.length === 0) {
        throw new RuleError(`Nothing is left to depreciate for ${month}.`);
      }
      const date = month === now.slice(0, 7) ? now : lastDay(month);
      const id = randomUUID();
      const number = await allocateNumber(tx, { organizationId: input.organizationId, documentType: "DEP", businessDate: date });
      const roles = await accountsFor(tx, input.organizationId, ["DEPRECIATION", "ACCUM_DEPR"]);
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(date),
        description: `Depreciation ${month}`,
        createdById: input.userId,
        doc: { type: "DEPRECIATION", id },
        number,
        lines: preview.rows.flatMap((row) => [
          { accountId: roles.get("DEPRECIATION") as string, debit: row.amount, credit: zero(), assetId: row.id, branchId: row.branchId, memo: row.code },
          { accountId: roles.get("ACCUM_DEPR") as string, debit: zero(), credit: row.amount, assetId: row.id, branchId: row.branchId, memo: row.code },
        ]),
      });
      const total = preview.rows.reduce((sum, row) => sum.plus(row.amount), zero());
      await tx.depreciationRun.create({ data: { id, organizationId: input.organizationId, month, journalId, total, assetCount: preview.rows.length, createdById: input.userId } });
      await remember(tx, { ...input, requestHash, entityType: "depreciation_run", entityId: id });
      return { id, total: text(total), count: preview.rows.length, replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "depreciate", module: "accounting", entityType: "depreciation_run", entityId: data.id, after: { month: input.month, total: data.total, assets: data.count }, ip: input.ip, userAgent: input.userAgent });
    }
    return { ok: true as const, ...data };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

export async function listRuns(organizationId: string) {
  const rows = await prisma.depreciationRun.findMany({ where: { organizationId }, orderBy: { month: "desc" }, take: 60 });
  return rows.map((row) => ({ id: row.id, month: row.month, total: text(row.total), assets: row.assetCount, journalId: row.journalId, createdAt: row.createdAt.toISOString() }));
}

/**
 * The month the dashboard reminds the owner to depreciate: last month when it was not done and something is due for it, or this month on its last
 * day. Null when nothing is waiting.
 */
export async function depreciationReminder(organizationId: string) {
  if ((await prisma.fixedAsset.count({ where: { organizationId, status: "ACTIVE" } })) === 0) {
    return null;
  }
  const now = today();
  const thisMonth = now.slice(0, 7);
  const candidates = now === lastDay(thisMonth) ? [addMonths(thisMonth, -1), thisMonth] : [addMonths(thisMonth, -1)];
  const latest = await prisma.depreciationRun.findFirst({ where: { organizationId }, orderBy: { month: "desc" }, select: { month: true } });
  for (const month of candidates) {
    if (latest && latest.month >= month) {
      continue;
    }
    const preview = await previewDepreciation(organizationId, month);
    if (preview.rows.length > 0) {
      return { month, total: preview.total, assets: preview.rows.length };
    }
  }
  return null;
}

// ---- selling or writing off ---------------------------------------------------------------------------------------------------------------

/**
 * Sells or writes off an asset (#38): Dr the money account (what it was sold for), Dr Accumulated Depreciation (all written off) / Cr Fixed Assets
 * (its cost); what came above what it was worth is Other income, below it Miscellaneous. Run the month's depreciation first if it should count.
 */
export async function disposeAsset(input: Actor & { assetId: string; businessDate: string; amount?: string; moneyAccountId?: string; note?: string }) {
  const requestHash = hashPayload({ dispose: input.assetId, date: input.businessDate, amount: input.amount ?? "", money: input.moneyAccountId ?? "", note: input.note ?? "" });
  try {
    const data = await runTx(async (tx) => {
      const existing = await replay(tx, { ...input, requestHash });
      if (existing) {
        return { id: existing.entityId, gain: null as string | null, replayed: true };
      }
      const asset = await lockAsset(tx, input.organizationId, input.assetId);
      if (asset.status !== "ACTIVE") {
        throw new RuleError("That asset was already sold or written off.", 409);
      }
      const date = checkDate(input.businessDate);
      if (date > today() || date < dateOnly(asset.purchaseDate)) {
        throw new RuleError("The date is between the purchase date and today.");
      }
      const received = amountOf(input.amount, "the amount received");
      const account = received.gt(0) ? await moneyAccountOf(tx, input.organizationId, input.moneyAccountId ?? "") : null;
      const own = (await figuresOf(tx, input.organizationId, [asset.id])).get(asset.id) ?? { cost: zero(), accumulated: zero() };
      const worth = own.cost.minus(own.accumulated);
      const gain = received.minus(worth);
      const journalId = await postBalancedJournal(tx, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        businessDate: occurredDate(date),
        description: `${received.gt(0) ? "Sold" : "Written off"} asset ${asset.code}: ${asset.name}`,
        createdById: input.userId,
        doc: { type: "ASSET_DISPOSAL", id: asset.id },
        lines: [
          ...(account ? [{ accountId: account.id, debit: received, credit: zero() }] : []),
          ...(own.accumulated.gt(0) ? [{ role: "ACCUM_DEPR" as const, debit: own.accumulated, credit: zero(), assetId: asset.id }] : []),
          { role: "FIXED_ASSET" as const, debit: zero(), credit: own.cost, assetId: asset.id },
          ...(gain.gt(0) ? [{ role: "OTHER_INCOME" as const, debit: zero(), credit: gain }] : []),
          ...(gain.lt(0) ? [{ role: "MISC" as const, debit: gain.neg(), credit: zero() }] : []),
        ],
      });
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: { status: "DISPOSED", disposedOn: occurredDate(date), disposalAmount: received, disposalAccountId: account?.id ?? null, disposalJournalId: journalId, disposalNote: input.note?.trim().slice(0, 255) || null },
      });
      await remember(tx, { ...input, requestHash, entityType: "fixed_asset_disposal", entityId: asset.id });
      return { id: asset.id, gain: text(gain), replayed: false };
    });
    if (!data.replayed) {
      await writeAudit({ organizationId: input.organizationId, branchId: input.branchId, userId: input.userId, action: "asset dispose", module: "accounting", entityType: "fixed_asset", entityId: data.id, after: { gain: data.gain }, ip: input.ip, userAgent: input.userAgent });
    }
    return { ok: true as const, ...data };
  } catch (error) {
    const mapped = failure(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}

// ---- the register -------------------------------------------------------------------------------------------------------------------------

/** Every asset with its cost, what has been written off and what it is worth now (from the books), and the totals by category. */
export async function assetRegister(organizationId: string) {
  const assets = await prisma.fixedAsset.findMany({ where: { organizationId }, orderBy: [{ status: "asc" }, { code: "asc" }], include: { branch: { select: { name: true } } } });
  const figures = await figuresOf(prisma, organizationId);
  const rows = assets.map((asset) => {
    const own = figures.get(asset.id) ?? { cost: zero(), accumulated: zero() };
    return {
      id: asset.id,
      code: asset.code,
      name: asset.name,
      category: asset.category,
      status: asset.status,
      branch: asset.branch.name,
      location: asset.location,
      purchaseDate: dateOnly(asset.purchaseDate),
      usefulLifeMonths: asset.usefulLifeMonths,
      cost: asset.cost,
      accumulated: asset.status === "ACTIVE" ? own.accumulated : zero(),
      bookValue: asset.status === "ACTIVE" ? own.cost.minus(own.accumulated) : zero(),
      disposedOn: asset.disposedOn ? dateOnly(asset.disposedOn) : null,
    };
  });
  const active = rows.filter((row) => row.status === "ACTIVE");
  const sum = (list: typeof rows, pick: (row: (typeof rows)[number]) => Prisma.Decimal) => list.reduce((total, row) => total.plus(pick(row)), zero());
  const byCategory = CATEGORIES.map((category) => {
    const list = active.filter((row) => row.category === category.value);
    return { category: category.value, label: category.label, count: list.length, cost: text(sum(list, (row) => row.cost)), accumulated: text(sum(list, (row) => row.accumulated)), bookValue: text(sum(list, (row) => row.bookValue)) };
  }).filter((row) => row.count > 0);
  return {
    rows: rows.map((row) => ({ ...row, cost: text(row.cost), accumulated: text(row.accumulated), bookValue: text(row.bookValue) })),
    byCategory,
    totals: { count: active.length, cost: text(sum(active, (row) => row.cost)), accumulated: text(sum(active, (row) => row.accumulated)), bookValue: text(sum(active, (row) => row.bookValue)) },
  };
}

export async function getAsset(organizationId: string, id: string) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, organizationId }, include: { branch: { select: { name: true } } } });
  if (!asset) {
    return null;
  }
  const own = (await figuresOf(prisma, organizationId, [asset.id])).get(asset.id) ?? { cost: zero(), accumulated: zero() };
  const lines = await prisma.journalLine.findMany({
    where: { organizationId, assetId: asset.id, account: { roles: { some: { role: { in: ["FIXED_ASSET", "ACCUM_DEPR"] } } } } },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, debit: true, credit: true, businessDate: true, account: { select: { name: true } }, journal: { select: { id: true, number: true, description: true } } },
  });
  const vendor = asset.vendorId ? await prisma.supplier.findUnique({ where: { id: asset.vendorId }, select: { name: true } }) : null;
  const paidFrom = asset.moneyAccountId ? await prisma.account.findUnique({ where: { id: asset.moneyAccountId }, select: { name: true } }) : null;
  const month = today().slice(0, 7);
  return {
    id: asset.id,
    code: asset.code,
    name: asset.name,
    category: asset.category,
    categoryLabel: CATEGORIES.find((category) => category.value === asset.category)?.label ?? asset.category,
    status: asset.status,
    branch: asset.branch.name,
    location: asset.location,
    note: asset.note,
    purchaseDate: dateOnly(asset.purchaseDate),
    cost: text(asset.cost),
    salvageValue: text(asset.salvageValue),
    usefulLifeMonths: asset.usefulLifeMonths,
    isOpening: asset.isOpening,
    openingDepreciation: text(asset.openingDepreciation),
    depreciationStartMonth: asset.depreciationStartMonth,
    depreciationEndMonth: addMonths(asset.depreciationStartMonth, Math.max(asset.depreciationMonths, 1) - 1),
    monthly: text(money(asset.cost.minus(asset.salvageValue).minus(asset.openingDepreciation).div(Math.max(asset.depreciationMonths, 1)))),
    paidWith: asset.paidWith,
    paidFrom: paidFrom?.name ?? null,
    vendor: vendor?.name ?? null,
    accumulated: text(asset.status === "ACTIVE" ? own.accumulated : zero()),
    bookValue: text(asset.status === "ACTIVE" ? own.cost.minus(own.accumulated) : zero()),
    thisMonth: asset.status === "ACTIVE" ? text(depreciationFor(asset, own.accumulated, month)) : "0.00",
    disposedOn: asset.disposedOn ? dateOnly(asset.disposedOn) : null,
    disposalAmount: asset.disposalAmount ? text(asset.disposalAmount) : null,
    disposalNote: asset.disposalNote,
    lines: lines.map((line) => ({ id: line.id, date: dateOnly(line.businessDate), account: line.account.name, debit: text(line.debit), credit: text(line.credit), journalId: line.journal.id, reference: line.journal.number ?? line.journal.description ?? "" })),
  };
}
