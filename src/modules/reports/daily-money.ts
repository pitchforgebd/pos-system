import { Prisma } from "@prisma/client";

import { dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { accountTotals, chart, col, dayBefore, dec, docBranches, identity, isMoney, lineBranches, money, netOf, sumOf, t, ZERO, type ReportCtx, type ReportResult } from "@/modules/reports/kit";

// The money reports (05 #5, #6, #9, #10): what came into and went out of the cash, bank and mobile accounts, by kind, and each account from its
// opening to its closing balance. Every figure is a journal line on a money account.

type MoneyLine = {
  id: string;
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  shiftId: string | null;
  branchId: string | null;
  businessDate: Date;
  journalId: string;
  docType: string | null;
  number: string | null;
  description: string | null;
  createdAt: Date;
  userName: string | null;
};

const IN: Record<string, string> = {
  CUSTOMER_PAYMENT: "Customer receipts",
  CUSTOMER_ADVANCE: "Customer advances",
  COURIER_SETTLEMENT: "Courier settlements",
  INCOME: "Other income",
  CAPITAL: "Capital added",
  LOAN: "Loans taken",
  CONTRA: "Transfers in",
  CASH_MOVEMENT: "Cash in",
  SHIFT_VARIANCE: "Drawer over",
  ASSET_DISPOSAL: "Assets sold",
  SUPPLIER_PAYMENT: "Refunds from vendors",
};
const OUT: Record<string, string> = {
  SUPPLIER_PAYMENT: "Vendor payments",
  SUPPLIER_ADVANCE: "Vendor advances",
  PURCHASE: "Purchases and transport",
  EXPENSE: "Expenses",
  EXPENSE_SETTLEMENT: "Owed expenses paid",
  SALE_RETURN: "Refunds to customers",
  LOAN: "Loan repayments",
  CAPITAL: "Owner drawings",
  ASSET_PURCHASE: "Assets bought",
  CONTRA: "Transfers out",
  SHIPMENT: "Delivery paid",
  CASH_MOVEMENT: "Cash out",
  SHIFT_VARIANCE: "Drawer short",
};
const BN: Record<string, string> = {
  "Customer receipts": "কাস্টমারের রসিদ",
  "Customer advances": "কাস্টমার অগ্রিম",
  "Courier settlements": "কুরিয়ার সেটেলমেন্ট",
  "Other income": "অন্যান্য আয়",
  "Capital added": "মূলধন",
  "Loans taken": "ঋণ গ্রহণ",
  "Transfers in": "ট্রান্সফার ইন",
  "Cash in": "ক্যাশ ইন",
  "Drawer over": "ড্রয়ারে বেশি",
  "Assets sold": "সম্পদ বিক্রি",
  "Refunds from vendors": "Vendor থেকে ফেরত",
  "Vendor payments": "Vendor পেমেন্ট",
  "Vendor advances": "Vendor অগ্রিম",
  "Purchases and transport": "ক্রয় ও পরিবহন",
  Expenses: "খরচ",
  "Owed expenses paid": "বকেয়া খরচ পরিশোধ",
  "Refunds to customers": "কাস্টমারকে ফেরত",
  "Loan repayments": "ঋণ পরিশোধ",
  "Owner drawings": "মালিকের উত্তোলন",
  "Assets bought": "সম্পদ ক্রয়",
  "Transfers out": "ট্রান্সফার আউট",
  "Delivery paid": "ডেলিভারি খরচ",
  "Cash out": "ক্যাশ আউট",
  "Drawer short": "ড্রয়ারে কম",
  Other: "অন্যান্য",
};
export const kindOf = (line: { docType: string | null; debit: Prisma.Decimal }) => (line.debit.gt(0) ? IN : OUT)[line.docType ?? ""] ?? "Other";
const bn = (label: string) => BN[label] ?? label;

/** Every line on a cash, bank or mobile account in the window, with its journal and who posted it. */
export async function moneyLines(ctx: ReportCtx, kinds: Array<"CASH" | "BANK" | "MOBILE"> = ["CASH", "BANK", "MOBILE"]): Promise<MoneyLine[]> {
  const rows = await prisma.$queryRaw<Array<MoneyLine & { debit: Prisma.Decimal | string; credit: Prisma.Decimal | string }>>`
    SELECT l.id AS id, l.accountId AS accountId, l.debit AS debit, l.credit AS credit, l.shiftId AS shiftId, l.branchId AS branchId, l.businessDate AS businessDate,
           j.id AS journalId, j.docType AS docType, j.number AS number, j.description AS description, j.createdAt AS createdAt, u.name AS userName
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    JOIN accounts a ON a.id = l.accountId AND a.kind IN (${Prisma.join(kinds)})
    LEFT JOIN users u ON u.id = j.createdById
    WHERE l.organizationId = ${ctx.organizationId} ${lineBranches(ctx)} AND l.businessDate BETWEEN ${ctx.from} AND ${ctx.to}
    ORDER BY j.createdAt, l.id
  `;
  return rows.map((row) => ({ ...row, debit: dec(row.debit), credit: dec(row.credit) }));
}

/** The bank or mobile charge each journal carries (Dr Bank charges / Mobile banking charges). */
async function chargesOf(organizationId: string, journalIds: string[]) {
  if (journalIds.length === 0) {
    return new Map<string, Prisma.Decimal>();
  }
  const rows = await prisma.$queryRaw<Array<{ journalId: string; charge: Prisma.Decimal | null }>>`
    SELECT l.journalId AS journalId, SUM(l.debit - l.credit) AS charge
    FROM journal_lines l
    JOIN account_roles r ON r.organizationId = l.organizationId AND r.accountId = l.accountId AND r.role IN ('BANK_CHARGE', 'MOBILE_CHARGE')
    WHERE l.organizationId = ${organizationId} AND l.journalId IN (${Prisma.join(journalIds)})
    GROUP BY l.journalId
  `;
  return new Map(rows.map((row) => [row.journalId, dec(row.charge)]));
}

const time = (date: Date) => date.toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" });

async function flowReport(ctx: ReportCtx, side: "IN" | "OUT"): Promise<ReportResult> {
  const accounts = await chart(ctx.organizationId);
  const name = new Map(accounts.map((account) => [account.id, account.name]));
  const lines = (await moneyLines(ctx)).filter((line) => (side === "IN" ? line.debit.gt(0) : line.credit.gt(0)));
  const charges = await chargesOf(ctx.organizationId, [...new Set(lines.map((line) => line.journalId))]);
  const amount = (line: MoneyLine) => (side === "IN" ? line.debit : line.credit);
  const rows = lines.map((line) => ({
    date: dateOnly(line.businessDate),
    time: time(line.createdAt),
    kind: kindOf(line),
    number: line.number ?? "",
    what: line.description ?? "",
    account: name.get(line.accountId) ?? "",
    amount: money(amount(line)),
    charge: money(charges.get(line.journalId) ?? ZERO),
    by: line.userName ?? "",
  }));
  const contra = lines.filter((line) => line.docType === "CONTRA");
  const others = lines.filter((line) => line.docType !== "CONTRA");
  const byKind = new Map<string, Prisma.Decimal>();
  const byAccount = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    byKind.set(kindOf(line), (byKind.get(kindOf(line)) ?? ZERO).plus(amount(line)));
    const accountName = name.get(line.accountId) ?? "";
    byAccount.set(accountName, (byAccount.get(accountName) ?? ZERO).plus(amount(line)));
  }
  const totals = await accountTotals(ctx, ctx.from, ctx.to);
  const gl = accounts.filter(isMoney).reduce((sum, account) => sum.plus(side === "IN" ? (totals.get(account.id)?.debit ?? ZERO) : (totals.get(account.id)?.credit ?? ZERO)), ZERO);
  const total = sumOf(lines, amount);
  const rowColumns = [col("date", "Date", "তারিখ"), col("time", "Time", "সময়"), col("kind", "Kind", "ধরন"), col("number", "Number", "নম্বর"), col("what", "What", "বিবরণ"), col("account", side === "IN" ? "Into" : "From", side === "IN" ? "কোথায়" : "কোথা থেকে"), col("amount", "Amount", "পরিমাণ", true), col("charge", "Charge", "চার্জ", true), col("by", "By", "কে")];
  return {
    key: side === "IN" ? "receive" : "payment",
    title: side === "IN" ? t("Money received", "টাকা এসেছে (Receive)") : t("Money paid out", "টাকা বাইরে গেছে (Payment)"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Total", "মোট"), value: money(total) },
      { label: t("Of it, transfers between own accounts", "এর মধ্যে নিজস্ব অ্যাকাউন্টে ট্রান্সফার"), value: money(sumOf(contra, amount)) },
      { label: t("Without the transfers", "ট্রান্সফার ছাড়া"), value: money(sumOf(others, amount)) },
    ],
    sections: [
      { key: "kinds", title: t("By kind", "ধরন অনুযায়ী"), columns: [col("kind", "Kind", "ধরন"), col("amount", "Amount", "পরিমাণ", true)], rows: [...byKind].map(([kind, value]) => ({ kind: `${kind} / ${bn(kind)}`, amount: money(value) })) },
      { key: "accounts", title: t("By account", "অ্যাকাউন্ট অনুযায়ী"), columns: [col("account", "Account", "অ্যাকাউন্ট"), col("amount", "Amount", "পরিমাণ", true)], rows: [...byAccount].map(([account, value]) => ({ account, amount: money(value) })) },
      { key: "lines", title: t("Each one", "প্রতিটি লেনদেন"), columns: rowColumns, rows, total: { amount: money(total) } },
    ],
    identities: [identity(side === "IN" ? t("Total = debits on cash, bank and mobile accounts", "মোট = সব টাকার অ্যাকাউন্টে ডেবিট") : t("Total = credits on cash, bank and mobile accounts", "মোট = সব টাকার অ্যাকাউন্টে ক্রেডিট"), total, gl)],
  };
}

export const receiveReport = (ctx: ReportCtx) => flowReport(ctx, "IN");
export const paymentReport = (ctx: ReportCtx) => flowReport(ctx, "OUT");

/** Each bank and mobile account: opening, money in, money out, charges, closing; and the lines (05 #9). */
export async function bankReport(ctx: ReportCtx): Promise<ReportResult> {
  const accounts = (await chart(ctx.organizationId)).filter((account) => account.kind === "BANK" || account.kind === "MOBILE");
  const [before, upTo, lines] = await Promise.all([accountTotals(ctx, null, dayBefore(ctx.from)), accountTotals(ctx, null, ctx.to), moneyLines(ctx, ["BANK", "MOBILE"])]);
  const charges = await chargesOf(ctx.organizationId, [...new Set(lines.map((line) => line.journalId))]);
  const per = accounts.map((account) => {
    const mine = lines.filter((line) => line.accountId === account.id);
    const opening = netOf(before, [account], () => true);
    const debit = sumOf(mine, (line) => line.debit);
    const credit = sumOf(mine, (line) => line.credit);
    const charge = sumOf([...new Set(mine.map((line) => line.journalId))], (id) => charges.get(id) ?? ZERO);
    return { account, opening, debit, credit, charge, closing: opening.plus(debit).minus(credit), gl: netOf(upTo, [account], () => true) };
  });
  const name = new Map(accounts.map((account) => [account.id, account.name]));
  return {
    key: "bank",
    title: t("Bank and mobile balances", "ব্যাংক ও মোবাইল ব্যালান্স"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Opening", "শুরু"), value: money(sumOf(per, (row) => row.opening)) },
      { label: t("In", "জমা"), value: money(sumOf(per, (row) => row.debit)) },
      { label: t("Out", "উত্তোলন"), value: money(sumOf(per, (row) => row.credit)) },
      { label: t("Closing", "শেষ"), value: money(sumOf(per, (row) => row.closing)) },
    ],
    sections: [
      {
        key: "accounts",
        title: t("Accounts", "অ্যাকাউন্ট"),
        columns: [col("account", "Account", "অ্যাকাউন্ট"), col("opening", "Opening", "শুরু", true), col("debit", "In", "জমা", true), col("credit", "Out", "উত্তোলন", true), col("charge", "Charges", "চার্জ", true), col("closing", "Closing", "শেষ", true)],
        rows: per.map((row) => ({ account: `${row.account.name} (${row.account.code})`, opening: money(row.opening), debit: money(row.debit), credit: money(row.credit), charge: money(row.charge), closing: money(row.closing) })),
        total: { opening: money(sumOf(per, (row) => row.opening)), debit: money(sumOf(per, (row) => row.debit)), credit: money(sumOf(per, (row) => row.credit)), charge: money(sumOf(per, (row) => row.charge)), closing: money(sumOf(per, (row) => row.closing)) },
      },
      {
        key: "lines",
        title: t("Lines", "লেনদেন"),
        columns: [col("date", "Date", "তারিখ"), col("account", "Account", "অ্যাকাউন্ট"), col("kind", "Kind", "ধরন"), col("number", "Number", "নম্বর"), col("debit", "In", "জমা", true), col("credit", "Out", "উত্তোলন", true)],
        rows: lines.map((line) => ({ date: dateOnly(line.businessDate), account: name.get(line.accountId) ?? "", kind: kindOf(line), number: line.number ?? line.description ?? "", debit: money(line.debit), credit: money(line.credit) })),
      },
    ],
    identities: per.length === 0 ? [] : [identity(t("Opening + in - out = the ledger balance at the end", "শুরু + জমা − উত্তোলন = দিনশেষে লেজারের ব্যালান্স"), sumOf(per, (row) => row.closing), sumOf(per, (row) => row.gl))],
  };
}

/** The cash of each branch: opening, what came in by kind (at the till, dues, advances ...), what went out, closing; the shifts (05 #10). */
export async function cashReport(ctx: ReportCtx): Promise<ReportResult> {
  const accounts = await chart(ctx.organizationId);
  const cash = accounts.filter((account) => account.kind === "CASH");
  const [before, upTo, lines, till, branches] = await Promise.all([
    accountTotals(ctx, null, dayBefore(ctx.from)),
    accountTotals(ctx, null, ctx.to),
    moneyLines(ctx, ["CASH"]),
    prisma.salePayment.findMany({ where: { organizationId: ctx.organizationId, method: "CASH", sale: { status: "POSTED", businessDate: { gte: new Date(`${ctx.from}T00:00:00.000Z`), lte: new Date(`${ctx.to}T00:00:00.000Z`) }, ...docBranches(ctx) } }, select: { amount: true, sale: { select: { branchId: true } } } }),
    prisma.branch.findMany({ where: { organizationId: ctx.organizationId, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  // The opening and closing of each branch: its cash lines up to the day before, and up to the last day.
  const branchOpening = await branchCash(ctx, cash.map((account) => account.id), dayBefore(ctx.from));
  const rows = branches.map((branch) => {
    const mine = lines.filter((line) => line.branchId === branch.id);
    const inOf = (docTypes: string[]) => sumOf(mine.filter((line) => docTypes.includes(line.docType ?? "")), (line) => line.debit);
    const outOf = (docTypes: string[]) => sumOf(mine.filter((line) => docTypes.includes(line.docType ?? "")), (line) => line.credit);
    const atTill = sumOf(till.filter((row) => row.sale.branchId === branch.id), (row) => row.amount);
    const receipts = inOf(["CUSTOMER_PAYMENT"]);
    const known = ["CUSTOMER_PAYMENT", "CUSTOMER_ADVANCE", "EXPENSE", "EXPENSE_SETTLEMENT", "SUPPLIER_PAYMENT", "SUPPLIER_ADVANCE", "PURCHASE", "SALE_RETURN", "CONTRA"];
    const opening = branchOpening.get(branch.id) ?? ZERO;
    const totalIn = sumOf(mine, (line) => line.debit);
    const totalOut = sumOf(mine, (line) => line.credit);
    return {
      branch: branch.name,
      opening,
      sales: atTill,
      dues: receipts.minus(atTill),
      advances: inOf(["CUSTOMER_ADVANCE"]),
      otherIn: totalIn.minus(receipts).minus(inOf(["CUSTOMER_ADVANCE"])).minus(inOf(["CONTRA"])),
      fromBank: inOf(["CONTRA"]),
      expenses: outOf(["EXPENSE", "EXPENSE_SETTLEMENT"]),
      payments: outOf(["SUPPLIER_PAYMENT", "SUPPLIER_ADVANCE", "PURCHASE"]),
      refunds: outOf(["SALE_RETURN"]),
      toBank: outOf(["CONTRA"]),
      otherOut: totalOut.minus(outOf(known)),
      closing: opening.plus(totalIn).minus(totalOut),
    };
  });
  const shifts = await shiftRows(ctx);
  const glClosing = netOf(upTo, cash, () => true);
  const glOpening = netOf(before, cash, () => true);
  const m = (row: (typeof rows)[number]) => ({ branch: row.branch, opening: money(row.opening), sales: money(row.sales), dues: money(row.dues), advances: money(row.advances), otherIn: money(row.otherIn), fromBank: money(row.fromBank), expenses: money(row.expenses), payments: money(row.payments), refunds: money(row.refunds), toBank: money(row.toBank), otherOut: money(row.otherOut), closing: money(row.closing) });
  const keys = ["opening", "sales", "dues", "advances", "otherIn", "fromBank", "expenses", "payments", "refunds", "toBank", "otherOut", "closing"] as const;
  const total = Object.fromEntries(keys.map((key) => [key, money(sumOf(rows, (row) => row[key]))]));
  return {
    key: "cash",
    title: t("Cash balance", "ক্যাশ ব্যালান্স"),
    from: ctx.from,
    to: ctx.to,
    summary: [
      { label: t("Opening cash", "শুরুর ক্যাশ"), value: money(glOpening) },
      { label: t("Closing cash", "শেষ ক্যাশ"), value: money(sumOf(rows, (row) => row.closing)) },
    ],
    sections: [
      {
        key: "branches",
        title: t("By branch", "ব্রাঞ্চ অনুযায়ী"),
        columns: [
          col("branch", "Branch", "ব্রাঞ্চ"),
          col("opening", "Opening", "শুরু", true),
          col("sales", "Sales (till)", "বিক্রি (নগদ)", true),
          col("dues", "Dues collected", "বাকি আদায়", true),
          col("advances", "Advances", "অগ্রিম", true),
          col("otherIn", "Other in", "অন্যান্য ইন", true),
          col("fromBank", "From bank", "ব্যাংক থেকে", true),
          col("expenses", "Expenses", "খরচ", true),
          col("payments", "Payments", "পেমেন্ট", true),
          col("refunds", "Refunds", "রিফান্ড", true),
          col("toBank", "To bank", "ব্যাংকে জমা", true),
          col("otherOut", "Other out", "অন্যান্য আউট", true),
          col("closing", "Closing", "শেষ", true),
        ],
        rows: rows.map(m),
        total,
      },
      {
        key: "shifts",
        title: t("Shifts", "শিফট"),
        columns: [col("cashier", "Cashier", "ক্যাশিয়ার"), col("status", "Status", "অবস্থা"), col("opening", "Opening", "শুরু", true), col("lines", "Cash in - out", "ইন − আউট", true), col("expected", "Expected", "থাকার কথা", true), col("counted", "Counted", "গণনা", true), col("difference", "Difference", "পার্থক্য", true)],
        rows: shifts.map((row) => ({ cashier: row.cashier, status: row.status, opening: money(row.opening), lines: money(row.lines), expected: money(row.expected), counted: row.counted === null ? "" : money(row.counted), difference: row.difference === null ? "" : money(row.difference) })),
      },
    ],
    identities: [
      identity(t("Closing = the cash accounts' ledger balance at the end", "শেষ ক্যাশ = দিনশেষে ক্যাশ অ্যাকাউন্টের লেজার ব্যালান্স"), sumOf(rows, (row) => row.closing), glClosing),
      ...(shifts.length > 0 ? [identity(t("Each shift: expected = opening + its own cash lines", "প্রতি শিফট: থাকার কথা = শুরু + নিজের ক্যাশ লাইন"), sumOf(shifts, (row) => row.expected), sumOf(shifts, (row) => row.opening.plus(row.lines)))] : []),
    ],
  };
}

async function branchCash(ctx: ReportCtx, cashIds: string[], upTo: string) {
  if (cashIds.length === 0) {
    return new Map<string, Prisma.Decimal>();
  }
  const rows = await prisma.$queryRaw<Array<{ branchId: string; net: Prisma.Decimal | null }>>`
    SELECT l.branchId AS branchId, SUM(l.debit - l.credit) AS net
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED'
    WHERE l.organizationId = ${ctx.organizationId} ${lineBranches(ctx)} AND l.accountId IN (${Prisma.join(cashIds)}) AND l.businessDate <= ${upTo}
    GROUP BY l.branchId
  `;
  return new Map(rows.map((row) => [row.branchId, dec(row.net)]));
}

/** The shifts opened in the window: opening, what their own cash lines add up to (the short/over entry at closing left out), expected, counted. */
async function shiftRows(ctx: ReportCtx) {
  const shifts = await prisma.shift.findMany({
    where: { organizationId: ctx.organizationId, ...docBranches(ctx), openedAt: { gte: new Date(`${ctx.from}T00:00:00+06:00`), lt: new Date(new Date(`${ctx.to}T00:00:00+06:00`).getTime() + 86_400_000) } },
    orderBy: { openedAt: "asc" },
    select: { id: true, status: true, openingCash: true, expectedCash: true, actualCash: true, difference: true, user: { select: { name: true } } },
  });
  if (shifts.length === 0) {
    return [];
  }
  const sums = await prisma.$queryRaw<Array<{ shiftId: string; net: Prisma.Decimal | null }>>`
    SELECT l.shiftId AS shiftId, SUM(l.debit - l.credit) AS net
    FROM journal_lines l
    JOIN journals j ON j.id = l.journalId AND j.status = 'POSTED' AND (j.docType IS NULL OR j.docType <> 'SHIFT_VARIANCE')
    JOIN accounts a ON a.id = l.accountId AND a.kind = 'CASH'
    WHERE l.organizationId = ${ctx.organizationId} AND l.shiftId IN (${Prisma.join(shifts.map((row) => row.id))})
    GROUP BY l.shiftId
  `;
  const net = new Map(sums.map((row) => [row.shiftId, dec(row.net)]));
  return shifts.map((row) => {
    const opening = dec(row.openingCash);
    const lines = net.get(row.id) ?? ZERO;
    const counted = row.status === "CLOSING" || row.status === "CLOSED";
    return { cashier: row.user.name, status: row.status, opening, lines, expected: counted && row.expectedCash !== null ? dec(row.expectedCash) : opening.plus(lines), counted: row.actualCash === null ? null : dec(row.actualCash), difference: row.difference === null ? null : dec(row.difference) };
  });
}

