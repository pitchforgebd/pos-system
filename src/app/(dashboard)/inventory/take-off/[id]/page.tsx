import { notFound, redirect } from "next/navigation";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getTakeOff } from "@/modules/inventory/documents";

export const metadata = { title: "Take-off" };

const PURPOSE_LABEL: Record<string, string> = {
  SAMPLE: "Sample",
  DEMO: "Demonstration",
  FIELD_TRIAL: "Field trial",
  OWN_USE: "Own use (drawing)",
  GIFT: "Gift",
};

export default async function TakeOffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const takeOff = await getTakeOff(session.organizationId, session.branchId, id);
  if (!takeOff) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={takeOff.number || "Take-off"}
        description={`${takeOff.businessDate} · ${takeOff.warehouseName} · ${takeOff.total}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Take-off", href: "/inventory/take-off" }, { label: takeOff.number || "Take-off" }]}
        actions={
          <div className="print:hidden">
            <PrintButton label="Print" />
          </div>
        }
      />
      <PrintSheet title="Take-off slip" note={takeOff.number}>
        <p>Date {takeOff.businessDate}</p>
        <p>From {takeOff.warehouseName}</p>
        <p>Why {PURPOSE_LABEL[takeOff.purpose ?? ""] ?? takeOff.purpose}</p>
        <p>Given to {takeOff.recipient}</p>
        <p>Approved by {takeOff.approvedBy}</p>
        {takeOff.note ? <p>Note {takeOff.note}</p> : null}
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="py-1 pr-2">SKU</th>
              <th className="py-1 pr-2">Product</th>
              <th className="py-1 pr-2">Quantity</th>
              <th className="py-1 pr-2">Unit cost</th>
              <th className="py-1">Value</th>
            </tr>
          </thead>
          <tbody>
            {takeOff.items.map((item) => (
              <tr key={item.id}>
                <td className="py-1 pr-2">{item.sku}</td>
                <td className="py-1 pr-2">{item.name}</td>
                <td className="py-1 pr-2">{item.quantity}</td>
                <td className="py-1 pr-2">{item.unitCost}</td>
                <td className="py-1">{item.totalCost}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="font-semibold">Total value {takeOff.total}</p>
      </PrintSheet>
    </div>
  );
}
