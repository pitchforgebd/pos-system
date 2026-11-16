import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  HandCoins,
  Info,
  Landmark,
  Minus,
  Package,
  PackagePlus,
  ShoppingCart,
  Store,
  TrendingUp,
  Truck,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { formatTakaCompact } from "@/lib/format/locale";
import { getI18n } from "@/lib/i18n/server";
import type { Dashboard } from "@/modules/reports/dashboard";

// The dashboard of a day (P13 + the redesign). Every figure appears once: a headline of the day, what needs attention, how sales are going, what to do
// next, what sold and who owes, and the size of the business. The figures are the reports' own (I16): a card opens its report.

export type Can = { sale: boolean; order: boolean; payment: boolean; purchase: boolean; expense: boolean; product: boolean; customer: boolean; reports: boolean; books: boolean; profit: boolean };

type Props = {
  board: Dashboard | null;
  name: string;
  branchName: string;
  day: string;
  scope: "branch" | "all";
  branches: { id: string; name: string }[];
  branchId: string | null;
  can: Can;
  worth: { net: string; assets: string; liabilities: string } | null;
  reminder: { month: string; assets: number; total: string } | null;
  hour: number;
};

const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-xl border border-border bg-surface ${className}`}>{children}</section>
);

export async function Today({ board, name, branchName, day, scope, branches, branchId, can, worth, reminder, hour }: Props) {
  const { t, taka, count, date, dayMonth, weekday, fmt } = await getI18n("dashboard");
  const card = (key: string) => board?.cards.find((row) => row.key === key);
  const value = (key: string) => card(key)?.value ?? "0.00";
  const more = board?.more;

  // ---- headline figures
  const todaySales = Number(value("sales"));
  const yesterday = board ? Number(board.week.at(-2)?.sales ?? 0) : 0;
  const change = yesterday > 0 ? Math.round(((todaySales - yesterday) / yesterday) * 100) : null;
  const trendText = change === null ? t("dashboard.noYesterday") : change === 0 ? t("dashboard.flat") : change > 0 ? t("dashboard.up", { pct: `${count(change)}%` }) : t("dashboard.down", { pct: `${count(Math.abs(change))}%` });
  const TrendIcon = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  const trendTone = change === null || change === 0 ? "text-muted" : change > 0 ? "text-success" : "text-error";

  type Kpi = { key: string; label: string; value: string; hint: string; href: string; icon: LucideIcon; tone: string; hintTone?: string; HintIcon?: LucideIcon };
  const kpis: Kpi[] = board
    ? [
        { key: "sales", label: t("dashboard.sales"), value: taka(value("sales")), hint: trendText, hintTone: trendTone, HintIcon: TrendIcon, href: card("sales")?.href ?? "/reports", icon: ShoppingCart, tone: "bg-info-subtle text-info" },
        { key: "moneyIn", label: t("dashboard.moneyIn"), value: taka(more?.moneyIn), hint: t("dashboard.moneyInSplit", { sale: taka(more?.paidAtSale), dues: taka(more?.dueCollected) }), href: card("dueCollected")?.href ?? "/reports", icon: HandCoins, tone: "bg-success-subtle text-success" },
        { key: "cash", label: t("dashboard.cash"), value: taka(value("cash")), hint: "", href: card("cash")?.href ?? "/reports", icon: Banknote, tone: "bg-success-subtle text-success" },
        { key: "bank", label: t("dashboard.bank"), value: taka(value("bank")), hint: "", href: card("bank")?.href ?? "/reports", icon: Landmark, tone: "bg-info-subtle text-info" },
        { key: "customersOwe", label: t("dashboard.customersOwe"), value: taka(value("customersOwe")), hint: t("dashboard.customersOweCount", { n: count(more?.customersOwing ?? 0) }), href: card("customersOwe")?.href ?? "/reports", icon: Users, tone: "bg-warning-subtle text-warning" },
        { key: "vendorsOwed", label: t("dashboard.vendorsOwed"), value: taka(value("vendorsOwed")), hint: "", href: card("vendorsOwed")?.href ?? "/reports", icon: Store, tone: "bg-warning-subtle text-warning" },
        { key: "expenses", label: t("dashboard.expenses"), value: taka(value("expenses")), hint: "", href: card("expenses")?.href ?? "/reports", icon: Wallet, tone: "bg-error-subtle text-error" },
        card("profit")
          ? { key: "profit", label: t("dashboard.profit"), value: taka(value("profit")), hint: more?.grossProfit ? t("dashboard.profitHint", { gross: taka(more.grossProfit) }) : "", href: card("profit")?.href ?? "/reports", icon: TrendingUp, tone: "bg-success-subtle text-success" }
          : { key: "paidOut", label: t("dashboard.paidOut"), value: taka(value("paidOut")), hint: "", href: card("paidOut")?.href ?? "/reports", icon: CircleDollarSign, tone: "bg-error-subtle text-error" },
      ]
    : [];
  if (kpis[0] && more && Number(more.returns) > 0) {
    kpis[0].hint = `${kpis[0].hint} · ${t("dashboard.salesNet", { amount: taka(more.net) })}`;
  }

  // ---- what needs attention
  type Alert = { key: string; text: string; href: string; tone: string; icon: LucideIcon };
  const alerts: Alert[] = [];
  if (board) {
    // found by the 7-day user test: the books let the cash go below zero without a word
    if (Number(value("cash")) < 0) alerts.push({ key: "cashNegative", text: t("dashboard.cashNegative", { amount: taka(value("cash")) }), href: card("cash")?.href ?? "/reports", tone: "border-error/40 bg-error-subtle text-error", icon: AlertTriangle });
    if (Number(value("bank")) < 0) alerts.push({ key: "bankNegative", text: t("dashboard.bankNegative", { amount: taka(value("bank")) }), href: card("bank")?.href ?? "/reports", tone: "border-error/40 bg-error-subtle text-error", icon: AlertTriangle });
    if (board.mismatches > 0) alerts.push({ key: "mismatch", text: t("dashboard.mismatch", { n: count(board.mismatches) }), href: "/reports/reconcile", tone: "border-error/40 bg-error-subtle text-error", icon: AlertTriangle });
    const low = Number(value("lowStock"));
    if (low > 0) alerts.push({ key: "low", text: t("dashboard.lowStock", { n: count(low) }), href: card("lowStock")?.href ?? "/inventory/alerts", tone: "border-warning/40 bg-warning-subtle text-warning", icon: Boxes });
    if (board.expiring.expired > 0) alerts.push({ key: "expired", text: t("dashboard.expired", { n: count(board.expiring.expired) }), href: "/reports/view?r=expiry", tone: "border-error/40 bg-error-subtle text-error", icon: AlertTriangle });
    if (board.expiring.soon > 0) alerts.push({ key: "soon", text: t("dashboard.expiring", { n: count(board.expiring.soon) }), href: "/reports/view?r=expiry", tone: "border-warning/40 bg-warning-subtle text-warning", icon: AlertTriangle });
    const waiting = board.orders.reduce((sum, row) => sum + row.count, 0);
    if (waiting > 0) alerts.push({ key: "orders", text: t("dashboard.orders", { n: count(waiting) }), href: "/orders", tone: "border-info/40 bg-info-subtle text-info", icon: ClipboardList });
    if (Number(value("courier")) > 0) alerts.push({ key: "courier", text: t("dashboard.courier", { amount: taka(value("courier")) }), href: card("courier")?.href ?? "/couriers", tone: "border-info/40 bg-info-subtle text-info", icon: Truck });
  }
  if (reminder) alerts.push({ key: "depreciation", text: t("dashboard.depreciation", { month: reminder.month }), href: `/accounting/depreciation?month=${reminder.month}`, tone: "border-warning/40 bg-warning-subtle text-warning", icon: AlertTriangle });

  // ---- the week
  const week = board?.week ?? [];
  const peak = Math.max(1, ...week.map((row) => Number(row.sales)));
  const weekTotal = week.reduce((sum, row) => sum + Number(row.sales), 0);

  // ---- what to do next
  const quick = [
    { show: can.sale, href: "/pos", label: t("dashboard.quickSale"), icon: ShoppingCart },
    { show: can.order, href: "/orders/new", label: t("dashboard.quickOrder"), icon: ClipboardList },
    { show: can.payment, href: "/customers/payments", label: t("dashboard.quickPayment"), icon: HandCoins },
    { show: can.purchase, href: "/purchases/new", label: t("dashboard.quickPurchase"), icon: Package },
    { show: can.expense, href: "/accounting/expenses", label: t("dashboard.quickExpense"), icon: Wallet },
    { show: can.product, href: "/products/new", label: t("dashboard.quickProduct"), icon: PackagePlus },
    { show: can.customer, href: "/customers/new", label: t("dashboard.quickCustomer"), icon: UserPlus },
    { show: can.reports, href: "/reports", label: t("dashboard.quickReports"), icon: BarChart3 },
  ].filter((row) => row.show);

  const greeting = hour < 5 ? t("dashboard.night", { name }) : hour < 12 ? t("dashboard.morning", { name }) : hour < 17 ? t("dashboard.afternoon", { name }) : t("dashboard.evening", { name });
  const topMax = Math.max(1, ...(more?.topProducts ?? []).map((row) => Number(row.amount)));
  const statusLabel: Record<string, string> = { CONFIRMED: t("dashboard.confirmed"), PACKED: t("dashboard.packed"), DISPATCHED: t("dashboard.dispatched") };

  return (
    <div className="space-y-4">
      {/* the day and who is looking */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{greeting}</h1>
          <p className="mt-0.5 text-sm text-muted">{t("dashboard.subtitle", { branch: scope === "all" ? t("dashboard.allBranches") : branchName, date: date(day) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardFilters day={day} scope={scope} branches={branches} branchId={branchId} />
          {can.reports ? (
            <Link href={`/reports/day?date=${day}`} className="inline-flex h-10 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-secondary">
              {t("dashboard.allReports")}
            </Link>
          ) : null}
          {can.sale ? (
            <Link href="/pos" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">
              <ShoppingCart className="size-4" aria-hidden="true" />
              {t("dashboard.newSale")}
            </Link>
          ) : null}
        </div>
      </Card>

      {/* what needs attention: nothing is shown twice, so each chip says something no card says */}
      {board ? (
        alerts.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={t("dashboard.alertsTitle")}>
            {alerts.map((alert) => (
              <li key={alert.key}>
                <Link href={alert.href} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${alert.tone}`}>
                  <alert.icon className="size-4 shrink-0" aria-hidden="true" />
                  {alert.text}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success-subtle px-3 py-1.5 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {t("dashboard.allGood")}
          </p>
        )
      ) : null}

      {/* the headline of the day */}
      {board ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <Link key={kpi.key} href={kpi.href} className="group rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-muted sm:p-4">
              <span className="flex items-center gap-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${kpi.tone}`} aria-hidden="true">
                  <kpi.icon className="size-4.5" />
                </span>
                <span className="text-xs font-medium text-muted sm:text-sm">{kpi.label}</span>
              </span>
              <span className="mt-2 block text-lg font-semibold tabular-nums sm:mt-3 sm:text-2xl">{kpi.value}</span>
              {kpi.hint ? (
                <span className={`mt-1 flex items-center gap-1 text-xs ${kpi.hintTone ?? "text-muted"}`}>
                  {kpi.HintIcon ? <kpi.HintIcon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                  {kpi.hint}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : (
        <Card className="p-4 text-sm text-muted">{t("dashboard.noReports")}</Card>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* sales, week by week, and the month and year so far */}
        {board && more ? (
          <Card className="p-4 lg:col-span-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">{t("dashboard.trendTitle")}</h2>
              <p className="text-sm text-muted">{t("dashboard.trendTotal", { amount: taka(String(weekTotal)) })}</p>
            </div>
            <ul className="mt-4 flex h-44 items-end gap-2 sm:gap-3" aria-label={t("dashboard.trendTitle")}>
              {week.map((row, index) => {
                const last = index === week.length - 1;
                return (
                  <li key={row.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${date(row.date)}: ${taka(row.sales)}`}>
                    <span className="text-[11px] font-medium tabular-nums text-muted">{Number(row.sales) > 0 ? formatTakaCompact(row.sales, fmt) : ""}</span>
                    <span className={`w-full rounded-t-md ${last ? "bg-primary" : "bg-info/60"}`} style={{ height: `${Math.max(3, (Number(row.sales) / peak) * 100)}%` }} />
                    <span className={`text-xs ${last ? "font-semibold text-text" : "text-muted"}`}>{weekday(row.date)}</span>
                    <span className="hidden text-[11px] text-muted sm:block">{dayMonth(row.date)}</span>
                  </li>
                );
              })}
            </ul>
            <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">{t("dashboard.month")}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{taka(more.month.sales)}</dd>
                {Number(more.month.returns) > 0 ? <dd className="text-xs text-muted">{t("dashboard.monthReturns", { amount: taka(more.month.returns) })}</dd> : null}
              </div>
              <div>
                <dt className="text-muted">{t("dashboard.year")}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{taka(more.year.sales)}</dd>
                <dd className="text-xs text-muted">{t("dashboard.yearHint", { date: date(more.year.from) })}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("dashboard.trendAverage")}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{taka(String(weekTotal / Math.max(1, week.length)))}</dd>
              </div>
            </dl>
          </Card>
        ) : null}

        {/* what to do next */}
        {quick.length > 0 ? (
          <Card className={`p-4 ${board ? "" : "lg:col-span-3"}`}>
            <h2 className="text-base font-semibold">{t("dashboard.quickTitle")}</h2>
            <ul className="mt-3 grid grid-cols-2 gap-2">
              {quick.map((row) => (
                <li key={row.href}>
                  <Link href={row.href} className="flex h-full items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium hover:bg-secondary">
                    <row.icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{row.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      {board && more ? (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <Card className="p-4">
            <h2 className="text-base font-semibold">{t("dashboard.topProducts")}</h2>
            {more.topProducts.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t("dashboard.topProductsEmpty")}</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {more.topProducts.map((row) => (
                  <li key={row.name} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{row.name}</span>
                      <span className="shrink-0 tabular-nums">{taka(row.amount)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-secondary" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (Number(row.amount) / topMax) * 100)}%` }} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{t("dashboard.sold", { qty: count(row.quantity) })}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">{t("dashboard.topDues")}</h2>
              <Link href={card("customersOwe")?.href ?? "/reports"} className="text-xs font-medium text-primary">
                {t("dashboard.seeAll")}
              </Link>
            </div>
            {more.topDues.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t("dashboard.topDuesEmpty")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {more.topDues.map((row) => (
                  <li key={row.name} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{row.name}</span>
                      {row.since ? <span className="text-xs text-muted">{t("dashboard.since", { date: date(row.since) })}</span> : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums">{taka(row.owed)}</span>
                      {row.late ? <span className="rounded bg-error-subtle px-1.5 py-0.5 text-[11px] font-medium text-error">{t("dashboard.overdue")}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-4 p-4">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">{t("dashboard.stockTitle")}</h2>
                <Link href="/inventory/alerts" className="text-xs font-medium text-primary">
                  {t("dashboard.seeAll")}
                </Link>
              </div>
              {board.lowStock.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{t("dashboard.stockEmpty")}</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {board.lowStock.slice(0, 5).map((row) => (
                    <li key={`${row.product}|${row.branch}`} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{row.product}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${row.status === "OUT_OF_STOCK" ? "bg-error-subtle text-error" : "bg-warning-subtle text-warning"}`}>
                        {row.status === "OUT_OF_STOCK" ? t("dashboard.stockOut") : count(row.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-border pt-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">{t("dashboard.ordersTitle")}</h2>
                <Link href="/orders" className="text-xs font-medium text-primary">
                  {t("dashboard.seeAll")}
                </Link>
              </div>
              {board.orders.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{t("dashboard.ordersEmpty")}</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                  {board.orders.map((row) => (
                    <li key={row.status} className="rounded-full bg-secondary px-3 py-1 font-medium text-secondary-foreground">
                      {statusLabel[row.status] ?? row.status} · {count(row.count)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {/* the size of the business */}
      {board && more ? (
        <Card className="p-4">
          <h2 className="text-base font-semibold">{t("dashboard.glanceTitle")}</h2>
          <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <Glance label={t("dashboard.customers")} value={count(more.counts.customers)} href="/customers" />
            <Glance label={t("dashboard.products")} value={count(more.counts.products)} href="/products" />
            <Glance label={t("dashboard.suppliers")} value={count(more.counts.suppliers)} href="/suppliers" />
            {card("stockValue") ? <Glance label={t("dashboard.stockValue")} value={taka(value("stockValue"))} hint={t("dashboard.stockLow", { n: count(value("lowStock")) })} href={card("stockValue")?.href ?? "/reports"} /> : null}
            {worth ? <Glance label={t("dashboard.worth")} value={taka(worth.net)} hint={t("dashboard.worthHint", { assets: taka(worth.assets), liabilities: taka(worth.liabilities) })} href="/accounting/worth" /> : null}
          </dl>
        </Card>
      ) : null}

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {t("dashboard.footer")}
      </p>
    </div>
  );
}

function Glance({ label, value, hint, href }: { label: string; value: string; hint?: string; href: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5">
        <Link href={href} className="text-lg font-semibold tabular-nums hover:underline">
          {value}
        </Link>
      </dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}
