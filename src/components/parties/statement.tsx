import Link from "next/link";

import { PrintSheet } from "@/components/print/document";
import { PrintButton } from "@/components/print/sheet";
import { Button } from "@/components/ui/button";
import type { statementOf } from "@/modules/customers/profile";
import { getI18n, getPhrase } from "@/lib/i18n/server";

type Statement = NonNullable<Awaited<ReturnType<typeof statementOf>>>;

/**
 * A customer's or vendor's printed statement: the balance at the start, every line with the running balance, and the end (P10 task 5).
 * After the 16-day user test: dates and amounts as the screen writes them, the title and the closing line in the screen's language.
 */
export async function PartyStatement({ statement, kind, back }: { statement: Statement; kind: "customer" | "vendor"; back: string }) {
  const ph = await getPhrase();
  const { taka, date } = await getI18n();
  const money = (value: string) => (value === "0.00" ? "" : taka(value));
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2 print:hidden" action="">
        <label className="grid gap-1 text-sm">
          {ph("From")}
          <input name="from" type="date" defaultValue={statement.from} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("To")}
          <input name="to" type="date" defaultValue={statement.to} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          {ph("Show")}
        </Button>
        <PrintButton label={ph("Print")} />
        <Link href={back} className="text-sm text-muted">
          {ph("Back")}
        </Link>
      </form>
      <PrintSheet
        title={kind === "customer" ? ph("Customer statement") : ph("Vendor statement")}
        meta={[
          { label: ph("From"), value: date(statement.from) },
          { label: ph("To"), value: date(statement.to) },
        ]}
        party={{ label: kind === "customer" ? ph("Customer") : ph("Vendor"), name: statement.party.name, lines: [statement.party.phone, statement.party.code] }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-black bg-gray-100 text-left">
              <th className="px-1 py-1">{ph("Date")}</th>
              <th className="px-1 py-1">{ph("Entry")}</th>
              <th className="px-1 py-1 text-right">{ph("Debit")}</th>
              <th className="px-1 py-1 text-right">{ph("Credit")}</th>
              <th className="px-1 py-1 text-right">{ph("Balance")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="px-1 py-1" colSpan={4}>
                {ph("At the start")}
              </td>
              <td className="px-1 py-1 text-right tabular-nums">{taka(statement.opening)}</td>
            </tr>
            {statement.rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-200">
                <td className="px-1 py-1 whitespace-nowrap">{date(row.date)}</td>
                <td className="px-1 py-1">{row.reference}</td>
                <td className="px-1 py-1 text-right tabular-nums">{money(row.debit)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{money(row.credit)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{taka(row.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-semibold">
              <td className="px-1 py-1" colSpan={4}>
                {kind === "customer" ? ph("At the end: the customer owes the shop") : ph("At the end: the shop owes the vendor")}
              </td>
              <td className="px-1 py-1 text-right tabular-nums">{taka(statement.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </PrintSheet>
    </div>
  );
}
