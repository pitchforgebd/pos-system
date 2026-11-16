import { notFound, redirect } from "next/navigation";

import { PrintSheet } from "@/components/print/document";
import { PrintButton } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getSupplierPayment } from "@/modules/purchasing/vendor-profile";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getI18n, getPhrase } from "@/lib/i18n/server";
import { takaInWords } from "@/lib/format/words";

export const generateMetadata = phraseTitled("Payment receipt");

export default async function SupplierPaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const payment = await getSupplierPayment(session.organizationId, id);
  if (!payment) {
    notFound();
  }
  const title = `${ph("Payment voucher")} ${payment.number ?? ""}`.trim();
  const { taka, date, lang } = await getI18n();

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: payment.supplier.name, href: `/suppliers/${payment.supplier.id}` }, { label: ph("Receipt") }]}
        actions={<PrintButton label={ph("Print receipt")} />}
      />
      <PrintSheet
        title={ph("Payment voucher")}
        meta={[
          { label: ph("Number"), value: payment.number ?? "" },
          { label: ph("Date"), value: date(payment.businessDate) },
        ]}
        party={{ label: ph("Paid to"), name: payment.supplier.name, lines: [payment.supplier.phone] }}
        signatures={[ph("Received by (vendor)"), ph("Authorised signature")]}
        footer={<p>{takaInWords(payment.amount, lang)}</p>}
      >
        <dl className="grid max-w-sm grid-cols-2 gap-x-4 gap-y-1">
          <dt>{ph("Amount paid to the vendor")}</dt>
          <dd className="text-right font-semibold tabular-nums">{taka(payment.amount)}</dd>
          {payment.charge !== "0.00" ? (
            <>
              <dt>{ph("Bank or mobile charge")}</dt>
              <dd className="text-right tabular-nums">{taka(payment.charge)}</dd>
            </>
          ) : null}
          <dt>{payment.method === "ADVANCE" ? ph("From") : ph("Paid from")}</dt>
          <dd className="text-right">{payment.account || payment.method}</dd>
        </dl>
        {payment.bills.length > 0 ? (
          <table className="w-full max-w-sm text-sm">
            <caption className="text-left font-medium">{ph("Settled")}</caption>
            <tbody>
              {payment.bills.map((bill) => (
                <tr key={bill.id}>
                  <td className="py-0.5">{bill.number}</td>
                  <td className="py-0.5 text-right tabular-nums">{taka(bill.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </PrintSheet>
    </div>
  );
}
