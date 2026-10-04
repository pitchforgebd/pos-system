import { notFound, redirect } from "next/navigation";

import { ActivateShiftForm, CloseShiftForm, CountForm, HandoverForm, MovementForm } from "@/components/shifts/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { getShift, listHandoverUsers } from "@/modules/shifts/shifts";

export const metadata = { title: "Shift" };

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
  const users = await listHandoverUsers(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={shift.cashierName}
        description={`${shift.status}. Opening ${shift.openingCash ?? "0.00"}. Expected ${shift.expectedCash ?? "not counted"}. Difference ${shift.difference ?? "not counted"}.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Shifts", href: "/shifts" }, { label: shift.status }]}
      />
      {shift.status === "OPEN" ? <ActivateShiftForm shiftId={shift.id} /> : null}
      {shift.status === "ACTIVE" ? (
        <>
          <MovementForm shiftId={shift.id} />
          <CountForm shiftId={shift.id} />
        </>
      ) : null}
      {shift.status === "CLOSING" ? (
        <>
          <CloseShiftForm shiftId={shift.id} />
          <HandoverForm
            shiftId={shift.id}
            users={users.filter((user) => user.id !== shift.userId).map((user) => ({ id: user.id, label: user.name }))}
          />
        </>
      ) : null}
      <DataTable
        caption="Cash movements"
        columns={[
          { key: "direction", header: "Direction", cell: (row) => row.direction },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
          { key: "reason", header: "Reason", cell: (row) => row.reason ?? "" },
        ]}
        rows={shift.movements}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No cash movements" description="Cash in and cash out are recorded only while the shift is active." />}
      />
      <DataTable
        caption="Handovers"
        columns={[
          { key: "to", header: "To", cell: (row) => row.toName },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
        ]}
        rows={shift.handovers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No handover" description="A handover is recorded while the shift is closing and does not change expected cash." />}
      />
    </div>
  );
}
