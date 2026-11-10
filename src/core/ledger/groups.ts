// The six account groups of the chart. A group is a statement section, so reports and account pickers need to say "the
// expense accounts" or "the revenue accounts"; they use these names, never the number. This is the one file that may write
// a group number (the static test checks that it matches the chart in prisma/chart-of-accounts.ts).
export const GROUP = {
  ASSET: "1000",
  LIABILITY: "2000",
  EQUITY: "3000",
  REVENUE: "4000",
  COST_OF_SALES: "5000",
  EXPENSE: "6000",
} as const;

export type GroupName = keyof typeof GROUP;
export type GroupCode = (typeof GROUP)[GroupName];
