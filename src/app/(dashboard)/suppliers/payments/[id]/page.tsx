import { notFound, redirect } from "next/navigation";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getSupplierPayment } from "@/modules/purchasing/vendor-profile";

export const metadata = { title: "Payment receipt" };

export default async function SupplierPaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const payment = await getSupplierPayment(session.organizationId, id);
  if (!payment) {
    notFound();
  }
  const title = `Payment ${payment.number ?? ""}`.trim();

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: payment.supplier.name, href: `/suppliers/${payment.supplier.id}` }, { label: "Receipt" }]}
        actions={<PrintButton label="Print receipt" />}
      />
      <PrintSheet title={title} note={`Paid to ${payment.supplier.name} on ${payment.businessDate}`}>
        <dl className="grid max-w-sm grid-cols-2 gap-x-4 gap-y-1">
          <dt>Amount paid to the vendor</dt>
          <dd className="text-right font-semibold tabular-nums">{payment.amount}</dd>
          {payment.charge !== "0.00" ? (
            <>
              <dt>Bank or mobile charge</dt>
              <dd className="text-right tabular-nums">{payment.charge}</dd>
            </>
          ) : null}
          <dt>{payment.method === "ADVANCE" ? "From" : "Paid from"}</dt>
          <dd className="text-right">{payment.account || payment.method}</dd>
        </dl>
        {payment.bills.length > 0 ? (
          <table className="w-full max-w-sm text-sm">
            <caption className="text-left font-medium">Settled</caption>
            <tbody>
              {payment.bills.map((bill) => (
                <tr key={bill.id}>
                  <td className="py-0.5">{bill.number}</td>
                  <td className="py-0.5 text-right tabular-nums">{bill.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </PrintSheet>
    </div>
  );
}
