import { notFound, redirect } from "next/navigation";

import { PrintButton } from "@/components/print/sheet";
import { CloseShiftForm, CountForm, HandoverForm, MovementForm } from "@/components/shifts/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { DENOMINATIONS, getShift, listHandoverUsers } from "@/modules/shifts/shifts";
import { counterAccountOptions, moneyPickerOptions } from "@/modules/treasury/dashboard";

export const metadata = { title: "Shift" };

const statusText = { OPEN: "Open", ACTIVE: "Open", CLOSING: "Counted, not closed", CLOSED: "Closed" } as const;

export default async function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
        title={`${shift.cashierName}'s shift`}
        description={`${statusText[shift.status]}. Opened ${shift.day}. The drawer should hold the opening cash plus what this shift's own cash lines add up to.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Shifts", href: "/shifts" }, { label: statusText[shift.status] }]}
        actions={<PrintButton label="Print shift report" />}
      />
      <section className="grid gap-3 sm:grid-cols-4" aria-label="Figures">
        <Figure label="Opening cash" value={shift.openingCash ?? "0.00"} />
        <Figure label={counted ? "Should have held" : "Should hold now"} value={counted ? (shift.expectedCash ?? shift.expectedNow) : shift.expectedNow} />
        <Figure label="Counted" value={shift.actualCash ?? "not counted"} />
        <Figure label="Difference" value={shift.difference ?? "not counted"} />
      </section>

      {live && mine ? (
        <>
          <section className="space-y-2" aria-label="Cash in or out">
            <h2 className="text-lg font-semibold">Cash in or out</h2>
            <MovementForm shiftId={shift.id} counters={counters} />
          </section>
          <section className="space-y-2" aria-label="Count the drawer">
            <h2 className="text-lg font-semibold">Count the drawer</h2>
            <CountForm shiftId={shift.id} denominations={[...DENOMINATIONS]} expected={shift.expectedNow} />
          </section>
        </>
      ) : null}
      {shift.status === "CLOSING" && mine ? (
        <section className="space-y-3" aria-label="Close">
          <h2 className="text-lg font-semibold">Close the shift</h2>
          <CloseShiftForm shiftId={shift.id} difference={shift.difference} />
          <h3 className="text-sm font-semibold">Hand the drawer over</h3>
          <HandoverForm
            shiftId={shift.id}
            users={users.filter((user) => user.id !== shift.userId).map((user) => ({ id: user.id, label: user.name }))}
            cashAccounts={otherCash.map((account) => ({ id: account.id, label: account.label }))}
          />
        </section>
      ) : null}

      <DataTable
        caption="What went through the drawer"
        columns={[
          { key: "what", header: "What", cell: (row) => row.label },
          { key: "in", header: "In", cell: (row) => row.in },
          { key: "out", header: "Out", cell: (row) => row.out },
        ]}
        rows={shift.byDocument}
        getRowKey={(row) => row.docType}
        empty={<EmptyState title="Nothing yet" description="Cash taken or paid in this shift shows here by kind of document." />}
      />
      {notes.length > 0 ? (
        <DataTable
          caption="Notes and coins counted"
          columns={[
            { key: "value", header: "Value", cell: (row) => row[0] },
            { key: "count", header: "Count", cell: (row) => row[1] },
            { key: "total", header: "Total", cell: (row) => (Number(row[0]) * row[1]).toFixed(2) },
          ]}
          rows={notes}
          getRowKey={(row) => row[0]}
        />
      ) : null}
      <DataTable
        caption="Cash movements"
        columns={[
          { key: "direction", header: "Direction", cell: (row) => (row.direction === "IN" ? "In" : "Out") },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
          { key: "reason", header: "Reason", cell: (row) => row.reason ?? "" },
        ]}
        rows={shift.movements}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No cash movements" description="Cash in and cash out are recorded while the shift is open." />}
      />
      <DataTable
        caption="Handovers"
        columns={[
          { key: "to", header: "To", cell: (row) => row.toName },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
        ]}
        rows={shift.handovers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No handover" description="A handover is recorded while the shift is counted and not yet closed." />}
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
