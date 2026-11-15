import { businessDate, isIsoDate } from "@/core/time/business-date";
import { cell, workbook, type Sheet } from "@/lib/export/xlsx";
import { toCsv } from "@/modules/imports/csv";
import type { SessionContext } from "@/modules/auth/session";
import { bankReport, cashReport, paymentReport, receiveReport } from "@/modules/reports/daily-money";
import { conditionReport, dueReport, expenseDayReport, profitReport, salesDayReport, stockDayReport } from "@/modules/reports/daily-trade";
import { assetsReport, balanceSheet, cashFlowReport, dayBookReport, districtMonth, expiryReport, monthlyProfit, paymentStatusReport, productMargin, stockValue, takeOffDamage, transactionsReport, trialBalanceReport, vatReport } from "@/modules/reports/more";
import type { ReportCtx, ReportResult, Text } from "@/modules/reports/kit";

// Every report by its key (P11), in the order the owner reads the day: cash, bank, money in, money out, sales, dues, couriers, expenses, stock,
// profit. A page, an export and the dashboard all run a report through here, so they get the same numbers.

export type ReportDef = { key: string; title: Text; daily: boolean; needs?: "reports.profit"; run: (ctx: ReportCtx) => Promise<ReportResult> };

export const DAILY: ReportDef[] = [
  { key: "cash", title: { en: "Cash balance", bn: "ক্যাশ ব্যালান্স" }, daily: true, run: cashReport },
  { key: "bank", title: { en: "Bank and mobile balance", bn: "ব্যাংক ব্যালান্স" }, daily: true, run: bankReport },
  { key: "receive", title: { en: "Money received", bn: "টাকা এসেছে" }, daily: true, run: receiveReport },
  { key: "payment", title: { en: "Money paid out", bn: "টাকা গেছে" }, daily: true, run: paymentReport },
  { key: "sales", title: { en: "Sales", bn: "বিক্রি" }, daily: true, run: salesDayReport },
  { key: "due", title: { en: "What is owed", bn: "বাকি" }, daily: true, run: dueReport },
  { key: "condition", title: { en: "Couriers (condition)", bn: "কন্ডিশন" }, daily: true, run: conditionReport },
  { key: "expenses", title: { en: "Expenses", bn: "খরচ" }, daily: true, run: expenseDayReport },
  { key: "stock", title: { en: "Stock", bn: "স্টক" }, daily: true, run: stockDayReport },
  { key: "profit", title: { en: "Profit and loss", bn: "লাভ-ক্ষতি" }, daily: true, needs: "reports.profit", run: profitReport },
];

/** The monthly and other reports (05 table). */
export const OTHER: ReportDef[] = [
  { key: "monthly-profit", title: { en: "Profit and loss by month", bn: "মাসিক লাভ-ক্ষতি" }, daily: false, needs: "reports.profit", run: monthlyProfit },
  { key: "district-month", title: { en: "Districts by month", bn: "জেলা × মাস" }, daily: false, run: districtMonth },
  { key: "payment-status", title: { en: "Payment status and age", bn: "পেমেন্ট স্ট্যাটাস" }, daily: false, run: paymentStatusReport },
  { key: "product-margin", title: { en: "Sales and margin by product", bn: "পণ্যভিত্তিক মার্জিন" }, daily: false, needs: "reports.profit", run: productMargin },
  { key: "stock-value", title: { en: "Stock value on a day", bn: "স্টক ভ্যালুয়েশন" }, daily: false, needs: "reports.profit", run: stockValue },
  { key: "expiry", title: { en: "Lots and expiry", bn: "মেয়াদ ও লট" }, daily: false, run: expiryReport },
  { key: "takeoff-damage", title: { en: "Take-off and damage", bn: "Take-off ও ড্যামেজ" }, daily: false, run: takeOffDamage },
  { key: "vat", title: { en: "VAT", bn: "VAT" }, daily: false, run: vatReport },
  { key: "assets", title: { en: "Fixed assets", bn: "সম্পদ রেজিস্টার" }, daily: false, run: assetsReport },
  { key: "trial-balance", title: { en: "Trial balance", bn: "ট্রায়াল ব্যালান্স" }, daily: false, needs: "reports.profit", run: trialBalanceReport },
  { key: "balance-sheet", title: { en: "Balance sheet", bn: "ব্যালান্স শিট" }, daily: false, needs: "reports.profit", run: balanceSheet },
  { key: "cash-flow", title: { en: "Cash flow", bn: "ক্যাশ ফ্লো" }, daily: false, run: cashFlowReport },
  { key: "day-book", title: { en: "Day book", bn: "ডে-বুক" }, daily: false, run: dayBookReport },
  { key: "transactions", title: { en: "Every transaction", bn: "সব লেনদেন" }, daily: false, run: transactionsReport },
];

const ALL = new Map<string, ReportDef>([...DAILY, ...OTHER].map((report) => [report.key, report]));

/** Other reports register here (monthly and the rest). */
export function registerReport(report: ReportDef) {
  ALL.set(report.key, report);
}

export const findReport = (key: string) => ALL.get(key) ?? null;
export const allReports = () => [...ALL.values()];

const iso = { test: (value: string) => isIsoDate(value) };

/**
 * The report's window and branches from the request (B10): one day (today in Dhaka) unless a range is asked; the session's branch, another branch
 * the user may use, or every branch with reports.all_branches.
 */
export function reportContext(session: Pick<SessionContext, "organizationId" | "branchId" | "branchIds" | "permissions">, query: { from?: string | null; to?: string | null; branch?: string | null }): ReportCtx | { error: string } {
  const today = businessDate();
  const to = query.to && iso.test(query.to) ? query.to : query.from && iso.test(query.from) ? query.from : today;
  const from = query.from && iso.test(query.from) ? query.from : to;
  if (from > to) {
    return { error: "The start date is after the end date." };
  }
  let branchIds: string[] | null;
  if (query.branch === "all") {
    if (!session.permissions.has("reports.all_branches")) {
      return { error: "Seeing every branch together needs the all-branches report permission." };
    }
    branchIds = null;
  } else if (query.branch) {
    if (!session.branchIds.has(query.branch)) {
      return { error: "That branch is not one of yours." };
    }
    branchIds = [query.branch];
  } else if (session.branchId) {
    branchIds = [session.branchId];
  } else {
    return { error: "Select a branch first." };
  }
  return { organizationId: session.organizationId, branchIds, from, to, canProfit: session.permissions.has("reports.profit") };
}

const plain = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));

/** The report as CSV: the title, the summary, then each table with its header (labels in the language asked). */
export function reportToCsv(result: ReportResult, lang: "en" | "bn" = "en") {
  const lines: string[][] = [[result.title[lang], `${result.from} - ${result.to}`]];
  for (const item of result.summary) {
    lines.push([item.label[lang], item.value]);
  }
  for (const section of result.sections) {
    lines.push([], [section.title[lang]], section.columns.map((column) => column.label[lang]));
    for (const row of section.rows) {
      lines.push(section.columns.map((column) => plain(row[column.key])));
    }
    if (section.total) {
      lines.push(section.columns.map((column, index) => (index === 0 ? "Total" : plain(section.total?.[column.key]))));
    }
  }
  lines.push([]);
  for (const check of result.identities) {
    lines.push([check.ok ? "OK" : "NOT OK", check.label[lang], check.left, check.right, check.difference]);
  }
  const [head, ...rest] = lines;
  return toCsv(head, rest);
}

/** The report as an Excel workbook: a sheet for the summary and the checks, and one per table. */
export function reportToXlsx(result: ReportResult, lang: "en" | "bn" = "en") {
  const sheets: Sheet[] = [
    {
      name: result.title[lang],
      rows: [[result.title[lang], `${result.from} - ${result.to}`], [], ...result.summary.map((item) => [item.label[lang], cell(item.value)]), [], ...result.identities.map((check) => [check.ok ? "OK" : "NOT OK", check.label[lang], cell(check.left), cell(check.right), cell(check.difference)])],
    },
    ...result.sections.map((section) => ({
      name: section.title[lang],
      rows: [
        section.columns.map((column) => column.label[lang]),
        ...section.rows.map((row) => section.columns.map((column) => cell(row[column.key]))),
        ...(section.total ? [section.columns.map((column, index) => (index === 0 ? "Total" : cell(section.total?.[column.key])))] : []),
      ],
    })),
  ];
  return workbook(sheets);
}
