import { notFound, redirect } from "next/navigation";

import { PrintButton } from "@/components/print/sheet";
import { CloseShiftForm, CountForm, HandoverForm, MovementForm } from "@/components/shifts/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { DENOMINATIONS, getShift, listHandoverUsers } from "@/modules/shifts/shifts";
import { counterAccountOptions, moneyPickerOptions } from "@/modules/treasury/dashboard";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Shift");

const statusText = { OPEN: "Shift is open", ACTIVE: "Shift is open", CLOSING: "Counted, not closed", CLOSED: "Shift is closed" } as const;

export default async function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const shift = await getShift(session.organizationId, session.branchId, id);
  if (!shift) {
    notFound();
  }
  const mine = shift.userId === session.userId;
  const live = shift.status === "OPEN" || shift.status === "ACTIVE";
  const [users, counters, money] = await Promise.all([listHandoverUsers(session.organizationId), counterAccountOptions(session.organizationId, shift.cashAccountId), moneyPickerOptions(session.organizationId)]);
  const otherCash = money.filter((account) => account.kind === "CASH" && account.id !== shift.cashAccountId);
  const counted = shift.status === "CLOSING" || shift.status === "CLOSED";
  const notes = shift.denominations ? Object.entries(shift.denominations).sort((a, b) => Number(b[0]) - Number(a[0])) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${ph("Shift of")} ${shift.cashierName}`}
        description={`${ph(statusText[shift.status])}. ${ph("Opened")} ${shift.day}. ${ph("The drawer should hold the opening cash plus what this shift's own cash lines add up to.")}`}
        breadcrumbs={[{ label: ph("Home"), href: "/dashboard" }, { label: ph("Shifts"), href: "/shifts" }, { label: ph(statusText[shift.status]) }]}
        actions={<PrintButton label={ph("Print shift report")} />}
      />
      <section className="grid gap-3 sm:grid-cols-4" aria-label={ph("Figures")}>
        <Figure label={ph("Opening cash")} value={shift.openingCash ?? "0.00"} />
        <Figure label={counted ? ph("Should have held") : ph("Should hold now")} value={counted ? (shift.expectedCash ?? shift.expectedNow) : shift.expectedNow} />
        <Figure label={ph("Counted")} value={shift.actualCash ?? ph("not counted")} />
        <Figure label={ph("Difference")} value={shift.difference ?? ph("not counted")} />
      </section>

      {live && mine ? (
        <>
          <section className="space-y-2" aria-label={ph("Cash in or out")}>
            <h2 className="text-lg font-semibold">{ph("Cash in or out")}</h2>
            <MovementForm shiftId={shift.id} counters={counters} />
          </section>
          <section className="space-y-2" aria-label={ph("Count the drawer")}>
            <h2 className="text-lg font-semibold">{ph("Count the drawer")}</h2>
            <CountForm shiftId={shift.id} denominations={[...DENOMINATIONS]} expected={shift.expectedNow} />
          </section>
        </>
      ) : null}
      {shift.status === "CLOSING" && mine ? (
        <section className="space-y-3" aria-label={ph("Close")}>
          <h2 className="text-lg font-semibold">{ph("Close the shift")}</h2>
          <CloseShiftForm shiftId={shift.id} difference={shift.difference} />
          <h3 className="text-sm font-semibold">{ph("Hand the drawer over")}</h3>
          <HandoverForm
            shiftId={shift.id}
            users={users.filter((user) => user.id !== shift.userId).map((user) => ({ id: user.id, label: user.name }))}
            cashAccounts={otherCash.map((account) => ({ id: account.id, label: account.label }))}
          />
        </section>
      ) : null}

      <DataTable
        caption={ph("What went through the drawer")}
        columns={[
          { key: "what", header: ph("What"), cell: (row) => ph(row.label) },
          { key: "in", header: ph("In"), cell: (row) => row.in },
          { key: "out", header: ph("Out"), cell: (row) => row.out },
        ]}
        rows={shift.byDocument}
        getRowKey={(row) => row.docType}
        empty={<EmptyState title={ph("Nothing yet")} description={ph("Cash taken or paid in this shift shows here by kind of document.")} />}
      />
      {notes.length > 0 ? (
        <DataTable
          caption={ph("Notes and coins counted")}
          columns={[
            { key: "value", header: ph("Value"), cell: (row) => row[0] },
            { key: "count", header: ph("Count"), cell: (row) => row[1] },
            { key: "total", header: ph("Total"), cell: (row) => (Number(row[0]) * row[1]).toFixed(2) },
          ]}
          rows={notes}
          getRowKey={(row) => row[0]}
        />
      ) : null}
      <DataTable
        caption={ph("Cash movements")}
        columns={[
          { key: "direction", header: ph("Direction"), cell: (row) => (row.direction === "IN" ? ph("In") : ph("Out")) },
          { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
          { key: "reason", header: ph("Reason"), cell: (row) => row.reason ?? "" },
        ]}
        rows={shift.movements}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No cash movements")} description={ph("Cash in and cash out are recorded while the shift is open.")} />}
      />
      <DataTable
        caption={ph("Handovers")}
        columns={[
          { key: "to", header: ph("To"), cell: (row) => row.toName },
          { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
        ]}
        rows={shift.handovers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No handover")} description={ph("A handover is recorded while the shift is counted and not yet closed.")} />}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
      {label}
      <span className="mt-1 block text-lg font-semibold">{value}</span>
    </p>
  );
}
