import { redirect } from "next/navigation";

import { PrintSheet } from "@/components/print/document";
import { PrintButton } from "@/components/print/sheet";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { accountStatement, defaultStatementRange, listAccounts } from "@/modules/accounting/books";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getI18n, getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Account statement");

// An account's ledger (a bank statement for a bank account). Made printable and readable after the 16-day user test: amounts as money,
// who each line was with, the totals and the closing balance.
export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ accountCode?: string; from?: string; to?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { taka, date } = await getI18n();
  const given = await searchParams;
  // A link to an account's ledger needs no dates: it opens on the current fiscal year up to today.
  const range = given.accountCode && (!given.from || !given.to) ? await defaultStatementRange(session.organizationId) : null;
  const query = { ...given, from: given.from || range?.from, to: given.to || range?.to };
  const accounts = await listAccounts(session.organizationId);
  const ready = Boolean(query.accountCode && query.from && query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.from) && /^\d{4}-\d{2}-\d{2}$/.test(query.to));
  const statement = ready
    ? await accountStatement({
        organizationId: session.organizationId,
        branchId: session.branchId,
        accountCode: query.accountCode ?? "",
        from: query.from ?? "",
        to: query.to ?? "",
      })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Account Statement")}
        description={ph("Opening is debit minus credit before the start date. Each later line updates that running balance. Cash and bank in and out are on Bank & Cash.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Statement") }]}
        actions={statement ? <PrintButton label={ph("Print")} /> : null}
      />
      <form className="flex flex-wrap items-end gap-3 print:hidden" method="get">
        <label className="grid min-w-64 gap-1 text-sm">
          {ph("Account")}
          <select name="accountCode" defaultValue={query.accountCode} className="h-10 rounded-md border border-border bg-surface px-2" required>
            {accounts.map((account) => (
              <option key={account.id} value={account.code}>
                {account.code} · {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {ph("From")}
          <input name="from" type="date" required defaultValue={query.from} className="h-10 rounded-md border border-border bg-surface px-2" />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("To")}
          <input name="to" type="date" required defaultValue={query.to} className="h-10 rounded-md border border-border bg-surface px-2" />
        </label>
        <Button type="submit">{ph("Show statement")}</Button>
      </form>
      {statement ? (
        <PrintSheet
          title={ph("Account Statement")}
          meta={[
            { label: ph("Account"), value: `${statement.account.code} · ${statement.account.name}` },
            { label: ph("From"), value: date(query.from ?? "") },
            { label: ph("To"), value: date(query.to ?? "") },
          ]}
        >
          {statement.lines.length === 0 ? (
            <EmptyState title={ph("No lines in this range")} description={ph("Posted journal lines for the account and dates will appear here.")} />
          ) : null}
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black bg-gray-100 text-left">
                <th className="px-1 py-1">{ph("Date")}</th>
                <th className="px-1 py-1">{ph("Reference")}</th>
                <th className="px-1 py-1">{ph("Particulars")}</th>
                <th className="px-1 py-1 text-right">{ph("Debit")}</th>
                <th className="px-1 py-1 text-right">{ph("Credit")}</th>
                <th className="px-1 py-1 text-right">{ph("Balance")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="px-1 py-1">{date(query.from ?? "")}</td>
                <td className="px-1 py-1" colSpan={4}>
                  {ph("Opening")}
                </td>
                <td className="px-1 py-1 text-right tabular-nums">{taka(statement.opening)}</td>
              </tr>
              {statement.lines.map((row) => (
                <tr key={row.id} className="border-b border-gray-200">
                  <td className="px-1 py-1 whitespace-nowrap">{date(row.businessDate)}</td>
                  <td className="px-1 py-1 whitespace-nowrap">{row.reference}</td>
                  <td className="px-1 py-1">
                    {row.party ? <span className="font-medium">{row.party}</span> : null}
                    {row.party && row.description ? " · " : null}
                    <span className="text-gray-600">{row.description}</span>
                  </td>
                  <td className="px-1 py-1 text-right tabular-nums">{row.debit !== "0.00" ? taka(row.debit) : ""}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{row.credit !== "0.00" ? taka(row.credit) : ""}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{taka(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-semibold">
                <td className="px-1 py-1" colSpan={3}>
                  {ph("Total")} · {ph("Closing balance")}
                </td>
                <td className="px-1 py-1 text-right tabular-nums">{taka(statement.debitTotal)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{taka(statement.creditTotal)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{taka(statement.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </PrintSheet>
      ) : null}
    </div>
  );
}
