import { Prisma, type JournalKind, type PartyType } from "@prisma/client";

import { accountsFor } from "@/core/ledger/accounts";
import { PARTY_ROLES, type AccountRole, type PartyRole } from "@/core/ledger/roles";
import { dateOnly } from "@/core/time/business-date";
import { assertPostable } from "@/core/time/period";

import { PostingError } from "@/core/posting/errors";

// The journal half of the posting engine (P02 task 4). Every money event in the system ends up here: it is the one place that
// writes a journal, and it refuses, before anything is saved, what the ledger must never hold:
//   I1   a journal that does not balance, or a line that is not exactly a debit or a credit above zero
//   I2   a receivable, payable, advance or courier line without its party (or with the wrong kind of party), or a party on any other line
//   a closed or foreign account, a posting into the future or a locked period (I11), a second journal for the same document
// The journal and all its lines are one insert, inside the caller's transaction, so they are saved with the document or not at all.

type Db = Prisma.TransactionClient;

/** The documents that have journals. One journal and one reversal per document (unique docType, docId, kind). */
export type DocType =
  | "SALE"
  | "SALE_RETURN"
  | "PURCHASE"
  | "PURCHASE_RETURN"
  | "CUSTOMER_PAYMENT"
  | "CUSTOMER_ADVANCE"
  | "CUSTOMER_OPENING"
  | "SUPPLIER_PAYMENT"
  | "SUPPLIER_ADVANCE"
  | "SHIPMENT"
  | "SHIFT_VARIANCE"
  | "EXPENSE_SETTLEMENT"
  | "CASH_MOVEMENT"
  | "SHIPMENT_RETURN"
  | "COURIER_SETTLEMENT"
  | "SUPPLIER_OPENING"
  | "EXPENSE"
  | "INCOME"
  | "CAPITAL"
  | "LOAN"
  | "VOUCHER"
  | "CONTRA"
  | "JOURNAL"
  | "BANK_OPENING"
  | "CASH_OPENING"
  | "LEGACY_ADVANCE"
  | "OPENING_RECLASS"
  | "OPENING_STOCK"
  | "STOCK_BOOKS_ADJUSTMENT"
  | "OWN_STOCK"
  | "STOCK_ADJUSTMENT"
  | "DAMAGE"
  | "EXPIRY_WRITEOFF"
  | "TAKE_OFF"
  | "TRANSFER"
  | "DIRECT_RETURN"
  | "LOYALTY_REDEEM";

export type PartyRef = { type: PartyType; id: string };

/**
 * One line of a journal. Name the account in exactly one way: by role (every account the posting rules own: cash, receivable,
 * sales ...), by id (a cash or bank account the user picked), or by code (an account the user typed in a manual journal). Code
 * in this system never writes an account number itself.
 */
export type PostLine = (
  | { role: AccountRole; accountId?: never; accountCode?: never }
  | { accountId: string; role?: never; accountCode?: never }
  | { accountCode: string; role?: never; accountId?: never }
) & {
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** Who the line is about; required on receivable, payable, advance and courier lines, forbidden on the others. */
  party?: PartyRef;
  shiftId?: string | null;
  assetId?: string | null;
  memo?: string | null;
  /** The branch of this line when it is not the journal's (a transfer's destination). */
  branchId?: string;
};

export type JournalPlan = {
  /** Give the journal this id (when the document needs it before the journal exists). */
  id?: string;
  organizationId: string;
  branchId: string;
  businessDate: Date;
  description: string;
  createdById: string;
  lines: PostLine[];
  /** The document this journal posts. */
  doc: { type: DocType; id: string };
  /** POSTING (default) or the REVERSAL of an earlier posting. */
  kind?: JournalKind;
  number?: string | null;
  reversalOfId?: string | null;
  /**
   * For a document that moved stock: how much the stock value of each branch changed (in minus out). The inventory account must
   * change by exactly this in each branch (I3), or the journal is refused. Set by postWithStock.
   */
  stockNet?: Map<string, Prisma.Decimal>;
};

const partyRoleIds = Object.keys(PARTY_ROLES) as PartyRole[];

function refuse(message: string, status: 404 | 409 | 422 = 422): never {
  throw new PostingError(message, status);
}

function checkSides(lines: PostLine[]) {
  if (lines.length < 2) {
    refuse("A journal needs at least two lines.");
  }
  let debit = new Prisma.Decimal(0);
  let credit = new Prisma.Decimal(0);
  for (const line of lines) {
    const hasDebit = line.debit.gt(0);
    const hasCredit = line.credit.gt(0);
    if (line.debit.isNeg() || line.credit.isNeg() || hasDebit === hasCredit) {
      refuse("A journal line must be a debit or a credit above zero.");
    }
    if ([line.role, line.accountId, line.accountCode].filter(Boolean).length !== 1) {
      refuse("A journal line names its account by role, id or code, one of them.");
    }
    debit = debit.plus(line.debit);
    credit = credit.plus(line.credit);
  }
  if (!debit.eq(credit)) {
    refuse("The journal is not balanced.");
  }
}

async function resolveAccounts(tx: Db, plan: JournalPlan) {
  const roles = [...new Set(plan.lines.flatMap((line) => (line.role ? [line.role] : [])))];
  const ids = [...new Set(plan.lines.flatMap((line) => (line.accountId ? [line.accountId] : [])))];
  const codes = [...new Set(plan.lines.flatMap((line) => (line.accountCode ? [line.accountCode] : [])))];
  const byRole = roles.length > 0 ? await accountsFor(tx, plan.organizationId, roles) : new Map<AccountRole, string>();
  const active = await tx.account.findMany({
    where: {
      organizationId: plan.organizationId,
      status: "ACTIVE",
      OR: [{ id: { in: [...ids, ...byRole.values()] } }, { code: { in: codes } }],
    },
    select: { id: true, code: true },
  });
  const activeIds = new Set(active.map((account) => account.id));
  const idByCode = new Map(active.map((account) => [account.code, account.id]));
  return plan.lines.map((line) => {
    const id = line.role ? byRole.get(line.role) : line.accountId ? line.accountId : idByCode.get(line.accountCode as string);
    if (!id || !activeIds.has(id)) {
      refuse(line.role || line.accountId ? "That account is closed or does not exist." : "The chart of accounts is missing an account this entry requires.");
    }
    return id;
  });
}

/** I2: which lines must carry a party and of which kind, and that every party exists in this organization. */
async function checkParties(tx: Db, plan: JournalPlan, accountIds: string[]) {
  const partyRoles = await accountsFor(tx, plan.organizationId, partyRoleIds);
  const roleOfAccount = new Map<string, PartyRole>([...partyRoles].map(([role, id]) => [id, role as PartyRole]));
  const wanted: Record<PartyType, Set<string>> = { CUSTOMER: new Set(), VENDOR: new Set(), COURIER: new Set(), EMPLOYEE: new Set() };
  plan.lines.forEach((line, index) => {
    const role = roleOfAccount.get(accountIds[index]);
    if (role) {
      if (!line.party) {
        refuse("This line needs a customer, vendor or courier. Receivable, payable and advance balances belong to a party.");
      }
      if (line.party.type !== PARTY_ROLES[role]) {
        refuse(`This line is about a ${PARTY_ROLES[role].toLowerCase()}, not a ${line.party.type.toLowerCase()}.`);
      }
    } else if (line.party) {
      refuse("Only receivable, payable and advance lines carry a party.");
    }
    if (line.party) {
      wanted[line.party.type].add(line.party.id);
    }
  });
  const where = (type: PartyType) => ({ id: { in: [...wanted[type]] }, organizationId: plan.organizationId });
  const found = {
    CUSTOMER: wanted.CUSTOMER.size ? await tx.customer.count({ where: where("CUSTOMER") }) : 0,
    VENDOR: wanted.VENDOR.size ? await tx.supplier.count({ where: where("VENDOR") }) : 0,
    COURIER: wanted.COURIER.size ? await tx.courier.count({ where: where("COURIER") }) : 0,
    EMPLOYEE: wanted.EMPLOYEE.size ? await tx.user.count({ where: where("EMPLOYEE") }) : 0,
  };
  for (const type of Object.keys(wanted) as PartyType[]) {
    if (found[type] !== wanted[type].size) {
      refuse("That record was not found.", 404);
    }
  }
}

/** I3: the inventory lines of the journal, branch by branch, add up to the change in stock value the document made. */
async function checkInventory(tx: Db, plan: JournalPlan, accountIds: string[]) {
  if (!plan.stockNet) {
    return;
  }
  const inventory = (await accountsFor(tx, plan.organizationId, ["INVENTORY"])).get("INVENTORY");
  const booked = new Map<string, Prisma.Decimal>();
  plan.lines.forEach((line, index) => {
    if (accountIds[index] === inventory) {
      const branchId = line.branchId ?? plan.branchId;
      booked.set(branchId, (booked.get(branchId) ?? new Prisma.Decimal(0)).plus(line.debit).minus(line.credit));
    }
  });
  for (const branchId of new Set([...booked.keys(), ...plan.stockNet.keys()])) {
    const stock = plan.stockNet.get(branchId) ?? new Prisma.Decimal(0);
    const books = booked.get(branchId) ?? new Prisma.Decimal(0);
    if (!stock.eq(books)) {
      refuse(`The inventory account moved by ${books.toFixed(2)} but the stock moved by ${stock.toFixed(2)} (I3).`);
    }
  }
}

/** Postings that put cash in the books by themselves, with nobody at a till: they belong to no shift. */
const NO_SHIFT: ReadonlySet<string> = new Set(["CASH_OPENING", "BANK_OPENING", "OPENING_RECLASS", "OPENING_STOCK", "STOCK_BOOKS_ADJUSTMENT", "LEGACY_ADVANCE", "JOURNAL"]);

/**
 * Which shift each line belongs to (P08, N7, D17). The cash a user takes or pays goes through their drawer: a line on a cash account with no
 * shift named is put in the posting user's active shift on that branch. When the shop requires shifts (D17) and the user has none, the posting is
 * refused, so no cash moves without a drawer that counts it. A shift the caller names must exist.
 */
async function attachShifts(tx: Db, plan: JournalPlan, accountIds: string[]): Promise<Array<string | null>> {
  const named = new Set(plan.lines.flatMap((line) => (line.shiftId ? [line.shiftId] : [])));
  if (named.size > 0 && (await tx.shift.count({ where: { id: { in: [...named] }, organizationId: plan.organizationId } })) !== named.size) {
    refuse("That record was not found.", 404);
  }
  const result: Array<string | null> = plan.lines.map((line) => line.shiftId ?? null);
  if (NO_SHIFT.has(plan.doc.type) || plan.kind === "REVERSAL") {
    return result;
  }
  const cash = await tx.account.findMany({ where: { id: { in: [...new Set(accountIds)] }, organizationId: plan.organizationId, kind: "CASH" }, select: { id: true } });
  const cashIds = new Set(cash.map((account) => account.id));
  const open = plan.lines.map((line, index) => (!line.shiftId && cashIds.has(accountIds[index]) ? index : -1)).filter((index) => index >= 0);
  if (open.length === 0) {
    return result;
  }
  const shift = await tx.shift.findFirst({ where: { organizationId: plan.organizationId, branchId: plan.branchId, userId: plan.createdById, status: "ACTIVE" }, select: { id: true } });
  if (shift) {
    for (const index of open) {
      result[index] = shift.id;
    }
    return result;
  }
  const shop = await tx.organization.findUnique({ where: { id: plan.organizationId }, select: { requireShift: true } });
  if (shop?.requireShift) {
    refuse("Open a shift before taking or paying cash.");
  }
  return result;
}

/**
 * Posts a journal inside the caller's transaction and returns its id. Throws PostingError (a 4xx for the user) when the entry is
 * not allowed; nothing is written then.
 */
export async function post(tx: Db, plan: JournalPlan): Promise<string> {
  checkSides(plan.lines);
  // The period rules apply to every posting: not in the future, not in a locked period (invariant I11).
  await assertPostable(tx, { organizationId: plan.organizationId }, dateOnly(plan.businessDate));
  const accountIds = await resolveAccounts(tx, plan);
  await checkParties(tx, plan, accountIds);
  await checkInventory(tx, plan, accountIds);
  const shifts = await attachShifts(tx, plan, accountIds);
  try {
    const journal = await tx.journal.create({
      data: {
        ...(plan.id ? { id: plan.id } : {}),
        organizationId: plan.organizationId,
        branchId: plan.branchId,
        businessDate: plan.businessDate,
        status: "POSTED",
        description: plan.description,
        postedAt: new Date(),
        createdById: plan.createdById,
        number: plan.number ?? null,
        reversalOfId: plan.reversalOfId ?? null,
        docType: plan.doc.type,
        docId: plan.doc.id,
        kind: plan.kind ?? "POSTING",
        lines: {
          create: plan.lines.map((line, index) => ({
            organizationId: plan.organizationId,
            accountId: accountIds[index],
            debit: line.debit,
            credit: line.credit,
            memo: line.memo ?? null,
            partyType: line.party?.type ?? null,
            partyId: line.party?.id ?? null,
            shiftId: shifts[index],
            assetId: line.assetId ?? null,
            // The date and branch of the journal are kept on every line, so reports need no join.
            businessDate: plan.businessDate,
            branchId: line.branchId ?? plan.branchId,
          })),
        },
      },
      select: { id: true },
    });
    return journal.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && String(error.meta?.target ?? "").includes("docType")) {
      refuse(plan.kind === "REVERSAL" ? "That document already has a reversal." : "That document already has its journal.", 409);
    }
    throw error;
  }
}
