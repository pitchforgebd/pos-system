import Link from "next/link";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { Button } from "@/components/ui/button";
import type { statementOf } from "@/modules/customers/profile";

type Statement = NonNullable<Awaited<ReturnType<typeof statementOf>>>;

/** A customer's or vendor's printed statement: the balance at the start, every line with the running balance, and the end (P10 task 5). */
export function PartyStatement({ statement, kind, back }: { statement: Statement; kind: "customer" | "vendor"; back: string }) {
  const owes = kind === "customer" ? "owes the shop" : "the shop owes";
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2 print:hidden" action="">
        <label className="grid gap-1 text-sm">
          From
          <input name="from" type="date" defaultValue={statement.from} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input name="to" type="date" defaultValue={statement.to} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <PrintButton label="Print" />
        <Link href={back} className="text-sm text-muted">
          Back
        </Link>
      </form>
      <PrintSheet title={`Statement · ${statement.party.name} (${statement.party.code})`} note={`${statement.from} to ${statement.to}${statement.party.phone ? ` · ${statement.party.phone}` : ""}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-1">Date</th>
              <th className="py-1">Entry</th>
              <th className="py-1 text-right">Debit</th>
              <th className="py-1 text-right">Credit</th>
              <th className="py-1 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-1" colSpan={4}>
                At the start
              </td>
              <td className="py-1 text-right tabular-nums">{statement.opening}</td>
            </tr>
            {statement.rows.map((row) => (
              <tr key={row.id} className="border-b border-border">
                <td className="py-1">{row.date}</td>
                <td className="py-1">{row.reference}</td>
                <td className="py-1 text-right tabular-nums">{row.debit === "0.00" ? "" : row.debit}</td>
                <td className="py-1 text-right tabular-nums">{row.credit === "0.00" ? "" : row.credit}</td>
                <td className="py-1 text-right tabular-nums">{row.balance}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1 font-semibold" colSpan={4}>
                At the end ({owes})
              </td>
              <td className="py-1 text-right font-semibold tabular-nums">{statement.closing}</td>
            </tr>
          </tbody>
        </table>
      </PrintSheet>
    </div>
  );
}
