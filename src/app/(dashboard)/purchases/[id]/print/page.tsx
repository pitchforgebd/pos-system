import { notFound, redirect } from "next/navigation";

import { PrintSheet } from "@/components/print/document";
import { PrintButton } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { takaInWords } from "@/lib/format/words";
import { getSession } from "@/modules/auth/current-session";
import { getPurchase } from "@/modules/purchasing/purchases";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getI18n, getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Purchase order");

// The purchase order sent to the vendor, or the received purchase (the bill) kept on file. Made professional after the 16-day user test:
// the shop's header, the vendor's contact, quantities and money written as money (not "50.0000"), the amount in words, signatures.
const WORDS = {
  en: { order: "Purchase order", bill: "Purchase (received)", number: "No.", date: "Date", received: "Received", vendorInvoice: "Vendor's invoice", vendor: "Vendor", sl: "#", inWords: "In words", haulage: "Haulage and other costs", landed: "Landed total", paid: "Paid with the bill", owed: "Still owed", prepared: "Prepared by", approved: "Approved by", vendorSign: "Vendor's signature" },
  bn: { order: "ক্রয় আদেশ", bill: "ক্রয় (গ্রহণ করা)", number: "নং", date: "তারিখ", received: "গ্রহণ", vendorInvoice: "সাপ্লায়ারের ইনভয়েস", vendor: "সাপ্লায়ার", sl: "ক্র.", inWords: "কথায়", haulage: "পরিবহন ও অন্যান্য খরচ", landed: "মোট খরচ (পরিবহনসহ)", paid: "বিলের সাথে পরিশোধ", owed: "বাকি পাওনা", prepared: "প্রস্তুতকারী", approved: "অনুমোদনকারী", vendorSign: "সাপ্লায়ারের স্বাক্ষর" },
} as const;

export default async function PurchasePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const purchase = await getPurchase(session.organizationId, session.branchId, id);
  if (!purchase || purchase.status === "DRAFT") {
    notFound();
  }
  const { lang, taka, qty, date } = await getI18n();
  const w = WORDS[lang];
  const received = purchase.status === "RECEIVED";
  const title = received ? w.bill : w.order;
  const paidWithBill = purchase.payments.reduce((sum, row) => sum + Number(row.amount), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${title} ${purchase.number ?? ""}`.trim()}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases", href: "/purchases" }, { label: purchase.number ?? ph("Purchase"), href: `/purchases/${id}` }, { label: ph("Print") }]}
        actions={<PrintButton label={ph("Print")} />}
      />
      <PrintSheet
        title={title}
        meta={[
          { label: w.number, value: purchase.number ?? "" },
          { label: w.date, value: date(purchase.businessDate) },
          ...(purchase.receivedOn ? [{ label: w.received, value: date(purchase.receivedOn) }] : []),
          ...(purchase.supplierInvoiceNo ? [{ label: w.vendorInvoice, value: purchase.supplierInvoiceNo }] : []),
        ]}
        party={{ label: w.vendor, name: purchase.supplier.name, lines: [purchase.supplier.phone, purchase.supplier.address, purchase.supplier.code] }}
        signatures={received ? [w.prepared, w.approved] : [w.prepared, w.vendorSign]}
        footer={purchase.note ? <p>{purchase.note}</p> : null}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-black bg-gray-100 text-left">
              <th className="w-8 px-1 py-1">{w.sl}</th>
              <th className="px-1 py-1">{ph("Product")}</th>
              <th className="px-1 py-1 text-right">{ph("Quantity")}</th>
              <th className="px-1 py-1 text-right">{ph("Unit cost")}</th>
              <th className="px-1 py-1 text-right">{ph("Discount")}</th>
              <th className="px-1 py-1 text-right">{ph("VAT")}</th>
              <th className="px-1 py-1 text-right">{ph("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map((item, index) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="px-1 py-1 tabular-nums">{index + 1}</td>
                <td className="px-1 py-1">
                  {item.name} <span className="text-xs text-gray-600">{item.sku}</span>
                  {item.lot ? <span className="block text-xs text-gray-600">{ph("Lot")} {item.lot}{item.expiresOn ? ` · ${date(item.expiresOn)}` : ""}</span> : null}
                  {item.serials.length > 0 ? <span className="block text-xs text-gray-600">{item.serials.join(", ")}</span> : null}
                </td>
                <td className="px-1 py-1 text-right tabular-nums">{qty(item.quantity)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{taka(Number(item.unitCost).toFixed(2))}</td>
                <td className="px-1 py-1 text-right tabular-nums">{item.discount !== "0.00" ? taka(item.discount) : "–"}</td>
                <td className="px-1 py-1 text-right tabular-nums">{item.vatAmount !== "0.00" ? taka(item.vatAmount) : "–"}</td>
                {/* the line's own amount: quantity x cost less its discount, plus its VAT (the bill discount is shown once, below) */}
                <td className="px-1 py-1 text-right tabular-nums">{taka((Math.round((Number(item.quantity) * Number(item.unitCost) - Number(item.discount) + Number(item.vatAmount)) * 100) / 100).toFixed(2))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-sm">
            <span className="block text-xs uppercase tracking-wide text-gray-600">{w.inWords}</span>
            {takaInWords(purchase.total, lang)}
          </p>
          <dl className="ml-auto grid min-w-64 grid-cols-2 gap-x-4">
            <dt>{ph("Goods")}</dt>
            <dd className="text-right tabular-nums">{taka(purchase.subtotal)}</dd>
            {purchase.discountTotal !== "0.00" ? (
              <>
                <dt>{ph("Discounts")}</dt>
                <dd className="text-right tabular-nums">− {taka(purchase.discountTotal)}</dd>
              </>
            ) : null}
            {purchase.vatTotal !== "0.00" ? (
              <>
                <dt>{ph("VAT")}</dt>
                <dd className="text-right tabular-nums">{taka(purchase.vatTotal)}</dd>
              </>
            ) : null}
            <dt className="border-t border-black pt-0.5 font-bold">{ph("Total")}</dt>
            <dd className="border-t border-black pt-0.5 text-right font-bold tabular-nums">{taka(purchase.total)}</dd>
            {purchase.chargesTotal !== "0.00" ? (
              <>
                <dt>{w.haulage}</dt>
                <dd className="text-right tabular-nums">{taka(purchase.chargesTotal)}</dd>
                <dt>{w.landed}</dt>
                <dd className="text-right tabular-nums">{taka(purchase.landedTotal)}</dd>
              </>
            ) : null}
            {received && paidWithBill > 0 ? (
              <>
                <dt>{w.paid}</dt>
                <dd className="text-right tabular-nums">{taka(paidWithBill.toFixed(2))}</dd>
              </>
            ) : null}
            {received && purchase.owed ? (
              <>
                <dt className="font-semibold">{w.owed}</dt>
                <dd className="text-right font-semibold tabular-nums">{taka(purchase.owed)}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </PrintSheet>
    </div>
  );
}
