import Link from "next/link";
import { redirect } from "next/navigation";

import { AccrueForm, ExpenseForm, PayDraftForm, RecurringForm, SettleForm } from "@/components/treasury/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { generateDrafts, listCategories, listExpenseRows, listRecurring, expenseReport } from "@/modules/treasury/expenses";
import { moneyPickerOptions } from "@/modules/treasury/dashboard";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Expenses");

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthsBack(from: string, count: number) {
  const [year, month] = from.split("-").map(Number);
  const index = year * 12 + (month - 1) - count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const today = businessDate();
  const thisMonth = today.slice(0, 7);
  const month = params.month && monthPattern.test(params.month) ? params.month : thisMonth;
  const canPost = session.permissions.has("accounting.post");
  // The start of the month: each recurring expense has its draft (made once; asking again changes nothing).
  if (canPost) {
    await generateDrafts({ organizationId: session.organizationId, branchId: session.branchId }, thisMonth);
  }
  const [categories, accounts, recurring, rows, report] = await Promise.all([
    listCategories(session.organizationId),
    moneyPickerOptions(session.organizationId),
    listRecurring(session.organizationId, session.branchId),
    listExpenseRows(session.organizationId, session.branchId, { periodMonth: month }),
    expenseReport(session.organizationId, session.branchId, monthsBack(thisMonth, 5), thisMonth),
  ]);
  const active = categories.filter((category) => category.status === "ACTIVE").map((category) => ({ id: category.id, label: category.name }));
  const drafts = rows.filter((row) => row.status === "DRAFT");
  const owed = rows.filter((row) => row.status === "ACCRUED");
  const paid = rows.filter((row) => row.status === "PAID");

  return (
    <div className="space-y-8">
      <PageHeader
        title={ph("Expenses")}
        description={ph("Pay an expense from cash, a bank or a mobile account; a bank or mobile charge is its own line. Fixed costs (rent, salary) get a draft each month: press Pay. What is still unpaid at month end can be booked as owed.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Expenses") }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/accounting/expenses">
        <label className="grid gap-1 text-sm">
          {ph("Month")}
          <input name="month" type="month" defaultValue={month} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          {ph("Show")}
        </Button>
        <Link href="/accounting/expenses/categories" className="text-sm text-muted">
          {ph("Categories")}
        </Link>
      </form>

      {canPost ? (
        <section className="space-y-3" aria-label={ph("New expense")}>
          <h2 className="text-lg font-semibold">{ph("New expense")}</h2>
          <ExpenseForm categories={active} accounts={accounts} today={today} />
        </section>
      ) : null}

      <section className="space-y-3" aria-label={ph("Drafts")}>
        <h2 className="text-lg font-semibold">{ph("Waiting to be paid (")}{month})</h2>
        <DataTable
          caption={ph("Drafts")}
          columns={[
            { key: "category", header: ph("Expense"), cell: (row) => row.category },
            { key: "due", header: ph("Due"), cell: (row) => row.businessDate },
            { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
            { key: "pay", header: "", cell: (row) => (canPost ? <PayDraftForm id={row.id} amount={row.amount} accounts={accounts} today={today} /> : null) },
          ]}
          rows={drafts}
          getRowKey={(row) => row.id}
          empty={<EmptyState title={ph("Nothing waiting")} description={ph("A recurring expense makes a draft here each month.")} />}
        />
        {session.permissions.has("expenses.accrue") ? (
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{ph("Month end")}</h3>
            <p className="text-xs text-muted">{ph("What is still a draft for the month is booked as owed (an expense and a liability), dated the last day of the month. Pay it later from the list below.")}</p>
            <AccrueForm month={month} />
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-label={ph("Owed")}>
        <h2 className="text-lg font-semibold">{ph("Booked as owed (")}{month})</h2>
        <DataTable
          caption={ph("Owed")}
          columns={[
            { key: "number", header: ph("Expense"), cell: (row) => row.number },
            { key: "category", header: ph("Category"), cell: (row) => row.category },
            { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
            { key: "pay", header: "", cell: (row) => (canPost ? <SettleForm id={row.id} amount={row.amount} accounts={accounts} today={today} /> : null) },
          ]}
          rows={owed}
          getRowKey={(row) => row.id}
          empty={<EmptyState title={ph("Nothing owed")} description={ph("No expense of this month is waiting as owed.")} />}
        />
      </section>

      <section className="space-y-3" aria-label={ph("Paid")}>
        <h2 className="text-lg font-semibold">{ph("Paid (")}{month})</h2>
        <DataTable
          caption={ph("Paid expenses")}
          columns={[
            { key: "number", header: ph("Expense"), cell: (row) => row.number },
            { key: "date", header: ph("Date"), cell: (row) => row.settledOn ?? row.businessDate },
            { key: "category", header: ph("Category"), cell: (row) => row.category },
            { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
            { key: "charge", header: ph("Charge"), cell: (row) => (row.charge === "0.00" ? "" : row.charge) },
            { key: "from", header: ph("Paid from"), cell: (row) => row.paidFrom ?? "" },
            { key: "note", header: ph("Note"), cell: (row) => row.note ?? "" },
          ]}
          rows={paid}
          getRowKey={(row) => row.id}
          empty={<EmptyState title={ph("No paid expenses")} description={ph("Nothing was paid for this month yet.")} />}
        />
      </section>

      <section className="space-y-3" aria-label={ph("Recurring")}>
        <h2 className="text-lg font-semibold">{ph("Every month")}</h2>
        <p className="text-sm text-muted">{ph("Fixed costs. Each month a draft is made for each of these.")}</p>
        <div className="space-y-2">
          {recurring.map((row) =>
            canPost ? (
              <RecurringForm key={row.id} categories={active} initial={{ id: row.id, categoryId: row.categoryId, amount: row.amount, dayOfMonth: row.dayOfMonth, note: row.note, active: row.active }} />
            ) : (
              <p key={row.id} className="text-sm">
                {row.category} · {row.amount} {ph("· day")} {row.dayOfMonth}
              </p>
            ),
          )}
          {canPost ? <RecurringForm categories={active} /> : null}
        </div>
      </section>

      <section className="space-y-3" aria-label={ph("By month")}>
        <h2 className="text-lg font-semibold">{ph("What each month cost")}</h2>
        <p className="text-xs text-muted">{ph("By the month an expense belongs to, however late it was paid. Paid and owed count; a draft is only waiting.")}</p>
        <DataTable
          caption={ph("Expenses by month")}
          columns={[
            { key: "month", header: ph("Month"), cell: (row) => row.month },
            { key: "category", header: ph("Category"), cell: (row) => row.category },
            { key: "booked", header: ph("Cost"), cell: (row) => row.booked },
            { key: "owed", header: ph("Still owed"), cell: (row) => (row.owed === "0.00" ? "" : row.owed) },
            { key: "draft", header: ph("Draft"), cell: (row) => (row.draft === "0.00" ? "" : row.draft) },
            { key: "charge", header: ph("Bank/mobile charge"), cell: (row) => (row.charge === "0.00" ? "" : row.charge) },
          ]}
          rows={report.rows}
          getRowKey={(row) => `${row.month}|${row.category}`}
          empty={<EmptyState title={ph("No expenses yet")} description={ph("Nothing is booked in the last six months.")} />}
        />
        <p className="text-sm">
          {ph("Total cost")} {report.totals.booked} {ph("· still owed")} {report.totals.owed} {ph("· charges")} {report.totals.charge}
        </p>
      </section>
    </div>
  );
}
