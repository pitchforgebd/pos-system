import Link from "next/link";

import type { Dashboard } from "@/modules/reports/dashboard";

// Today on the dashboard (P11 task 7): the cards (each opens its report), the last seven days of sales, orders waiting, low stock, lots about to expire.
// A red banner says when a check of the day's reports does not agree with the books.

export function TodayBoard({ board, lang }: { board: Dashboard; lang: "en" | "bn" }) {
  const max = Math.max(1, ...board.week.map((row) => Number(row.sales)));
  const bn = lang === "bn";
  return (
    <section className="space-y-4" aria-label={bn ? "আজকের হিসাব" : "Today"}>
      {board.mismatches > 0 ? (
        <Link href="/reports/reconcile" className="block rounded-md border border-error/40 bg-error-subtle px-3 py-2 text-sm font-medium text-error">
          {bn ? `${board.mismatches}টি হিসাব মিলছে না। দেখুন।` : `${board.mismatches} check(s) of today's reports do not agree with the books. Look.`}
        </Link>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {board.cards.map((card) => (
          <Link key={card.key} href={card.href} className="rounded-xl border border-border bg-surface px-4 py-3 hover:bg-secondary">
            <span className="block text-xs font-semibold tracking-wide text-muted">{card.label[lang]}</span>
            <span className="mt-1 block text-xl font-semibold tabular-nums">{card.value}</span>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-3 lg:col-span-2" role="img" aria-label={bn ? "৭ দিনের বিক্রি" : "Sales of the last seven days"}>
          <h2 className="text-sm font-semibold">{bn ? "৭ দিনের বিক্রি" : "Sales, last 7 days"}</h2>
          <ul className="mt-3 flex h-36 items-end gap-2">
            {board.week.map((row) => (
              <li key={row.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1 text-[10px]">
                <span className="tabular-nums">{Number(row.sales) > 0 ? row.sales : ""}</span>
                <span className="w-full rounded-t bg-[#0f8f78]" style={{ height: `${Math.max(2, (Number(row.sales) / max) * 100)}%` }} />
                <span className="text-muted">{row.date.slice(5)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-surface p-3 text-sm">
          <div>
            <h2 className="font-semibold">{bn ? "অপেক্ষমান অর্ডার" : "Orders waiting"}</h2>
            {board.orders.length === 0 ? <p className="text-muted">{bn ? "কিছু নেই" : "None"}</p> : <p>{board.orders.map((row) => `${row.status} ${row.count}`).join(" · ")}</p>}
          </div>
          <div>
            <h2 className="font-semibold">{bn ? "মেয়াদ" : "Expiry"}</h2>
            <p>{bn ? `শেষ ${board.expiring.expired}টি লট · ৩০ দিনে শেষ ${board.expiring.soon}টি` : `${board.expiring.expired} lot(s) expired · ${board.expiring.soon} expire within 30 days`}</p>
          </div>
          <div>
            <h2 className="font-semibold">{bn ? "কম স্টক" : "Low stock"}</h2>
            {board.lowStock.length === 0 ? <p className="text-muted">{bn ? "কিছু নেই" : "None"}</p> : (
              <ul>
                {board.lowStock.slice(0, 5).map((row) => (
                  <li key={`${row.product}|${row.branch}`} className="flex justify-between gap-2">
                    <span>{row.product}</span>
                    <span className={row.status === "OUT_OF_STOCK" ? "text-error" : "text-warning"}>{row.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted">{bn ? "প্রতিটি সংখ্যা তার রিপোর্টের সংখ্যা। ৩০ সেকেন্ডে নতুন হয়।" : "Every number is its report's number. Refreshed every 30 seconds."}</p>
    </section>
  );
}
