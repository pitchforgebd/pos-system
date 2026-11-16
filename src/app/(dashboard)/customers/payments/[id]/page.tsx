import { notFound, redirect } from "next/navigation";

import { PrintSheet } from "@/components/print/document";
import { PrintButton } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { takaInWords } from "@/lib/format/words";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getI18n, getPhrase } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { getCustomerPayment } from "@/modules/customers/dues";

export const generateMetadata = phraseTitled("Money receipt");

// The money receipt a customer gets when they pay a due (added after the 16-day user test: a due collected had nothing to print).
// Printed on A4 or on the 80 mm roll (?print=thermal).
const WORDS = {
  en: { title: "Money receipt", number: "Receipt no.", date: "Date", from: "Received from", code: "Customer code", amount: "Amount received", how: "Paid by", charge: "Bank / mobile charge (borne by the shop)", before: "Due before this payment", after: "Due after this payment", settled: "Settled", inWords: "In words", by: "Received by", customerSign: "Customer's signature", authorisedSign: "Authorised signature", thanks: "Thank you.", methods: { CASH: "Cash", BANK: "Bank", MOBILE: "Mobile banking", WALLET: "Advance" } },
  bn: { title: "মানি রিসিট", number: "রসিদ নং", date: "তারিখ", from: "যাঁর কাছ থেকে", code: "কাস্টমার কোড", amount: "গৃহীত টাকা", how: "মাধ্যম", charge: "ব্যাংক / মোবাইল চার্জ (দোকান বহন করে)", before: "এই পেমেন্টের আগে বাকি", after: "এই পেমেন্টের পর বাকি", settled: "যে ইনভয়েসে জমা", inWords: "কথায়", by: "গ্রহণকারী", customerSign: "ক্রেতার স্বাক্ষর", authorisedSign: "অনুমোদিত স্বাক্ষর", thanks: "ধন্যবাদ।", methods: { CASH: "নগদ", BANK: "ব্যাংক", MOBILE: "মোবাইল ব্যাংকিং", WALLET: "অগ্রিম" } },
} as const;

export default async function CustomerPaymentReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const thermal = (await searchParams).print === "thermal";
  const payment = await getCustomerPayment(session.organizationId, id);
  if (!payment) {
    notFound();
  }
  const { lang, taka, date } = await getI18n();
  const w = WORDS[lang];
  const how = payment.account ?? w.methods[payment.method as keyof typeof w.methods] ?? payment.method;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${w.title} ${payment.number ?? ""}`.trim()}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Customers"), href: "/customers" }, { label: ph("Collect due"), href: "/customers/payments" }, { label: payment.number ?? "" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <PrintButton label={ph("Print receipt")} />
            <a className="text-sm underline" href={`/customers/payments/${id}${thermal ? "" : "?print=thermal"}`}>
              {thermal ? "A4" : "80 mm"}
            </a>
          </div>
        }
      />
      <PrintSheet
        title={w.title}
        thermal={thermal}
        meta={[
          { label: w.number, value: payment.number ?? "" },
          { label: w.date, value: date(payment.businessDate) },
          ...(payment.receivedBy ? [{ label: w.by, value: payment.receivedBy }] : []),
        ]}
        party={{ label: w.from, name: payment.customer.name, lines: [payment.customer.phone, payment.customer.address, `${w.code}: ${payment.customer.code}`] }}
        signatures={thermal ? undefined : [w.customerSign, w.authorisedSign]}
        footer={<p className="text-center">{w.thanks}</p>}
      >
        <dl className={thermal ? "grid grid-cols-2 gap-x-2" : "grid max-w-md grid-cols-2 gap-x-4 gap-y-1"}>
          <dt className="font-semibold">{w.amount}</dt>
          <dd className="text-right text-base font-bold tabular-nums">{taka(payment.amount)}</dd>
          <dt>{w.how}</dt>
          <dd className="text-right">{how}</dd>
          {payment.charge !== "0.00" ? (
            <>
              <dt>{w.charge}</dt>
              <dd className="text-right tabular-nums">{taka(payment.charge)}</dd>
            </>
          ) : null}
          <dt>{w.before}</dt>
          <dd className="text-right tabular-nums">{taka(payment.owedBefore)}</dd>
          <dt className="font-semibold">{w.after}</dt>
          <dd className="text-right font-semibold tabular-nums">{taka(payment.owedAfter)}</dd>
        </dl>
        <p>
          <span className="text-xs uppercase tracking-wide text-gray-600">{w.inWords}: </span>
          {takaInWords(payment.amount, lang)}
        </p>
        {payment.settled.length > 0 ? (
          <table className="w-full max-w-md border-collapse text-sm">
            <caption className="text-left font-medium">{w.settled}</caption>
            <tbody>
              {payment.settled.map((row, index) => (
                <tr key={`${row.invoice}-${index}`} className="border-b border-gray-200">
                  <td className="py-0.5">{row.invoice === "Opening due" ? ph("Opening due") : row.invoice}</td>
                  <td className="py-0.5 text-right tabular-nums">{taka(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </PrintSheet>
    </div>
  );
}
