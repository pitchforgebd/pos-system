import { notFound, redirect } from "next/navigation";

import { PrintSheet } from "@/components/print/document";
import { PrintButton } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { takaInWords } from "@/lib/format/words";
import { titled } from "@/lib/i18n/metadata";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { getOrder } from "@/modules/orders/orders";

export const generateMetadata = titled("orders", "orders.print");

// The printed quotation and order (made professional after the 16-day user test: the shop's header, numbers, who it is for, amount in words).
const WORDS = {
  en: { quotation: "Quotation", order: "Sales order", number: "No.", date: "Date", validUntil: "Valid until", quotedTo: "Quotation for", orderedBy: "Customer", deliverTo: "Deliver to", sl: "#", inWords: "In words", customerSign: "Customer's signature", authorisedSign: "Authorised signature", terms: "Prices are valid until the date above and subject to stock. Delivery charges, if any, are shown separately." },
  bn: { quotation: "কোটেশন", order: "বিক্রয় অর্ডার", number: "নং", date: "তারিখ", validUntil: "মেয়াদ", quotedTo: "যাঁর জন্য", orderedBy: "কাস্টমার", deliverTo: "ডেলিভারির ঠিকানা", sl: "ক্র.", inWords: "কথায়", customerSign: "ক্রেতার স্বাক্ষর", authorisedSign: "অনুমোদিত স্বাক্ষর", terms: "উপরের তারিখ পর্যন্ত দাম কার্যকর, স্টক থাকা সাপেক্ষে। ডেলিভারি চার্জ থাকলে আলাদা দেখানো হয়েছে।" },
} as const;

export default async function OrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const order = await getOrder(session.organizationId, session.branchId, id);
  if (!order) {
    notFound();
  }
  const { t, taka, date, qty, lang } = await getI18n("orders");
  const w = WORDS[lang];
  const quote = order.isQuotation && order.status === "DRAFT";
  const title = (quote ? t("orders.printQuotation", { number: order.quotationNumber ?? "" }) : t("orders.printOrder", { number: order.number ?? "" })).trim();

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Orders", href: "/orders" }, { label: order.number ?? order.quotationNumber ?? t("orders.colOrder"), href: `/orders/${id}` }, { label: "Print" }]}
        actions={<PrintButton label={t("orders.print")} />}
      />
      <PrintSheet
        title={quote ? w.quotation : w.order}
        meta={[
          { label: w.number, value: (quote ? order.quotationNumber : order.number) ?? "" },
          { label: w.date, value: date(order.businessDate) },
          ...(quote && order.validUntil ? [{ label: w.validUntil, value: date(order.validUntil) }] : []),
        ]}
        party={{ label: quote ? w.quotedTo : w.orderedBy, name: order.customer.name, lines: [order.customer.phone, order.shippingAddress ? `${w.deliverTo}: ${order.shippingAddress}` : null] }}
        signatures={[w.customerSign, w.authorisedSign]}
        footer={quote ? <p>{w.terms}</p> : order.note ? <p>{order.note}</p> : null}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-black bg-gray-100 text-left">
              <th className="w-8 px-1 py-1">{w.sl}</th>
              <th className="px-1 py-1">{t("orders.product")}</th>
              <th className="px-1 py-1 text-right">{t("orders.quantity")}</th>
              <th className="px-1 py-1 text-right">{t("orders.price")}</th>
              <th className="px-1 py-1 text-right">{t("orders.discount")}</th>
              <th className="px-1 py-1 text-right">{t("orders.colTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, index) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="px-1 py-1 tabular-nums">{index + 1}</td>
                <td className="px-1 py-1">
                  {item.name} <span className="text-xs text-gray-600">{item.sku}</span>
                </td>
                <td className="px-1 py-1 text-right tabular-nums">{qty(item.quantity)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{taka(item.unitPrice)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{item.discountAmount !== "0.00" ? taka(item.discountAmount) : "–"}</td>
                <td className="px-1 py-1 text-right tabular-nums">{taka(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-sm">
            <span className="block text-xs uppercase tracking-wide text-gray-600">{w.inWords}</span>
            {takaInWords(order.total, lang)}
          </p>
          <dl className="ml-auto grid min-w-64 grid-cols-2 gap-x-4">
            <dt>{t("orders.goods")}</dt>
            <dd className="text-right tabular-nums">{taka(order.subtotal)}</dd>
            {order.discountTotal !== "0.00" ? (
              <>
                <dt>{t("orders.discounts")}</dt>
                <dd className="text-right tabular-nums">− {taka(order.discountTotal)}</dd>
              </>
            ) : null}
            {order.vatTotal !== "0.00" ? (
              <>
                <dt>{t("orders.vat")}</dt>
                <dd className="text-right tabular-nums">{taka(order.vatTotal)}</dd>
              </>
            ) : null}
            {order.chargesTotal !== "0.00" ? (
              <>
                <dt>{t("orders.chargesShort")}</dt>
                <dd className="text-right tabular-nums">{taka(order.chargesTotal)}</dd>
              </>
            ) : null}
            <dt className="border-t border-black pt-0.5 font-bold">{t("orders.total")}</dt>
            <dd className="border-t border-black pt-0.5 text-right font-bold tabular-nums">{taka(order.total)}</dd>
          </dl>
        </div>
      </PrintSheet>
    </div>
  );
}
