import { notFound, redirect } from "next/navigation";

import { PrintSheet } from "@/components/print/document";
import { PrintButton } from "@/components/print/sheet";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { takaInWords } from "@/lib/format/words";
import { buildI18n } from "@/lib/i18n/build";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { getSale } from "@/modules/sales/sales";

export async function generateMetadata() {
  return { title: (await getI18n("sales")).t("sales.fallback") };
}

// What the invoice says, in the language the cashier chose (the language of the screen, or ?lang=bn or en for this one) and on the paper the shop prints on
// (?print=thermal for 80 mm). Amounts are in taka with the lakh grouping and dates are written out, in the digits the person chose (P13).
const WORDS = {
  en: {
    invoice: "Invoice", receipt: "Cash memo", number: "Invoice no.", date: "Date", customer: "Customer", billTo: "Bill to", code: "Customer code", soldBy: "Served by", level: "Price level",
    sl: "#", item: "Item", qty: "Qty", price: "Unit price", total: "Total", goods: "Subtotal", discount: "Discount", vat: "VAT", charges: "Delivery / charges", paid: "Paid", change: "Due on this invoice", later: "Paid later or returned",
    owes: "Customer's total due now", status: "Status", inWords: "In words", customerSign: "Customer's signature", authorisedSign: "Authorised signature",
    thanks: "Thank you for shopping with us. Goods once sold are taken back only with this invoice.",
    methods: { CASH: "Cash", BANK: "Bank", MOBILE: "Mobile banking", CARD: "Card", WALLET: "Advance", OTHER: "Other" },
  },
  bn: {
    invoice: "ইনভয়েস", receipt: "ক্যাশ মেমো", number: "ইনভয়েস নং", date: "তারিখ", customer: "কাস্টমার", billTo: "ক্রেতা", code: "কাস্টমার কোড", soldBy: "বিক্রেতা", level: "দামের লেভেল",
    sl: "ক্র.", item: "পণ্য", qty: "পরিমাণ", price: "একক দাম", total: "মোট", goods: "উপমোট", discount: "ছাড়", vat: "ভ্যাট", charges: "ডেলিভারি / চার্জ", paid: "পরিশোধ", change: "এই ইনভয়েসে বাকি", later: "পরে পরিশোধ বা ফেরত",
    owes: "কাস্টমারের মোট বাকি এখন", status: "অবস্থা", inWords: "কথায়", customerSign: "ক্রেতার স্বাক্ষর", authorisedSign: "অনুমোদিত স্বাক্ষর",
    thanks: "আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ। বিক্রিত পণ্য এই ইনভয়েস ছাড়া ফেরত নেওয়া হয় না।",
    methods: { CASH: "নগদ", BANK: "ব্যাংক", MOBILE: "মোবাইল ব্যাংকিং", CARD: "কার্ড", WALLET: "অগ্রিম", OTHER: "অন্যান্য" },
  },
} as const;

export default async function SaleDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string; lang?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const query = await searchParams;
  const sale = await getSale(session.organizationId, session.branchId, id);
  if (!sale) {
    notFound();
  }
  const thermal = query.print === "thermal";
  const page = await getI18n("sales");
  const lang: "bn" | "en" = query.lang === "bn" || query.lang === "en" ? query.lang : page.lang;
  const t = WORDS[lang];
  // the invoice itself follows ?lang, the rest of the page the screen's language
  const f = buildI18n({ lang, digits: page.digits }, {});
  const s = page.t;
  const fallback = s("sales.fallback");
  // what was paid after the sale (receipts) or taken off by returns: the invoice is total - paid at the sale - this - still owed
  const paidAtSale = sale.payments.reduce((sum, row) => sum + Number(row.amount), 0);
  const settledLater = Math.round((Number(sale.total) - paidAtSale - Number(sale.owed)) * 100) / 100;
  const link = (print: boolean, next: "bn" | "en") => `/sales/${sale.id}?${print ? "print=thermal&" : ""}lang=${next}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={sale.number ?? fallback}
        description={`${sale.customerName} · ${page.date(sale.businessDate)} · ${page.taka(sale.total)}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales", href: "/sales" }, { label: sale.number ?? fallback }]}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="secondary" href="/pos">
              {s("sales.newSale")}
            </Button>
            <PrintButton label={thermal ? s("sales.print80") : s("sales.printA4")} />
            <a className="text-sm underline" href={link(!thermal, lang)}>
              {thermal ? s("sales.a4") : s("sales.r80")}
            </a>
            <a className="text-sm underline" href={link(thermal, lang === "bn" ? "en" : "bn")}>
              {lang === "bn" ? "English" : "বাংলা"}
            </a>
          </div>
        }
      />
      <PrintSheet
        title={thermal ? t.receipt : t.invoice}
        thermal={thermal}
        meta={[
          { label: t.number, value: sale.number ?? fallback },
          { label: t.date, value: `${f.date(sale.businessDate)} ${new Date(sale.createdAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" })}` },
          ...(sale.soldBy ? [{ label: t.soldBy, value: sale.soldBy }] : []),
          ...(sale.priceLevel ? [{ label: t.level, value: sale.priceLevel }] : []),
        ]}
        party={{
          label: t.billTo,
          name: sale.customer?.businessName && sale.customer.businessName !== sale.customerName ? `${sale.customerName} (${sale.customer.businessName})` : sale.customerName,
          lines: sale.customer ? [sale.customer.phone, sale.customer.address, sale.customer.code ? `${t.code}: ${sale.customer.code}` : null] : [],
        }}
        signatures={thermal ? undefined : [t.customerSign, t.authorisedSign]}
        footer={<p className="text-center">{t.thanks}</p>}
      >
        {thermal ? (
          // on the 80 mm roll each item takes two lines: its name, then quantity x price = total (a name in a narrow column wrapped badly)
          <ul className="space-y-1">
            {sale.items.map((item) => (
              <li key={item.id}>
                <p>{item.name}</p>
                <p className="flex justify-between tabular-nums">
                  <span>
                    {f.qty(item.quantity)} × {f.taka(item.unitPrice)}
                    {item.discount !== "0.00" ? ` − ${f.taka(item.discount)}` : ""}
                  </span>
                  <span>{f.taka(item.lineTotal)}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        <table className={thermal ? "hidden" : "w-full border-collapse text-sm"}>
          <thead>
            <tr className={thermal ? "border-b border-dashed border-black text-left" : "border-y border-black bg-gray-100 text-left"}>
              {thermal ? null : <th className="px-1 py-1 w-8">{t.sl}</th>}
              <th className="px-1 py-1">{t.item}</th>
              <th className="px-1 py-1 text-right">{t.qty}</th>
              <th className="px-1 py-1 text-right">{t.price}</th>
              {thermal ? null : <th className="px-1 py-1 text-right">{t.discount}</th>}
              {thermal ? null : <th className="px-1 py-1 text-right">{t.vat}</th>}
              <th className="px-1 py-1 text-right">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, index) => (
              <tr key={item.id} className={thermal ? "" : "border-b border-gray-200"}>
                {thermal ? null : <td className="px-1 py-1 tabular-nums">{index + 1}</td>}
                <td className="px-1 py-1">{item.name}</td>
                <td className="px-1 py-1 text-right tabular-nums">
                  {f.qty(item.quantity)}
                  {item.unit && !thermal ? ` ${item.unit}` : ""}
                </td>
                <td className="px-1 py-1 text-right tabular-nums">{f.taka(item.unitPrice)}</td>
                {thermal ? null : <td className="px-1 py-1 text-right tabular-nums">{item.discount !== "0.00" ? f.taka(item.discount) : "–"}</td>}
                {thermal ? null : <td className="px-1 py-1 text-right tabular-nums">{item.vat !== "0.00" ? f.taka(item.vat) : "–"}</td>}
                <td className="px-1 py-1 text-right tabular-nums">{f.taka(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={thermal ? "" : "flex flex-wrap items-start justify-between gap-4"}>
          {thermal ? null : (
            <p className="max-w-sm text-sm">
              <span className="block text-xs uppercase tracking-wide text-gray-600">{t.inWords}</span>
              {takaInWords(sale.total, lang)}
            </p>
          )}
          <dl className={thermal ? "grid grid-cols-2 gap-x-2" : "ml-auto grid min-w-64 grid-cols-2 gap-x-4 text-sm"}>
            <dt>{t.goods}</dt>
            <dd className="text-right tabular-nums">{f.taka(sale.subtotal)}</dd>
            {sale.discountTotal !== "0.00" ? (
              <>
                <dt>{t.discount}</dt>
                <dd className="text-right tabular-nums">− {f.taka(sale.discountTotal)}</dd>
              </>
            ) : null}
            {sale.vatTotal !== "0.00" ? (
              <>
                <dt>{t.vat}</dt>
                <dd className="text-right tabular-nums">{f.taka(sale.vatTotal)}</dd>
              </>
            ) : null}
            {sale.chargesTotal !== "0.00" ? (
              <>
                <dt>{t.charges}</dt>
                <dd className="text-right tabular-nums">{f.taka(sale.chargesTotal)}</dd>
              </>
            ) : null}
            <dt className="border-t border-black pt-0.5 font-bold">{t.total}</dt>
            <dd className="border-t border-black pt-0.5 text-right font-bold tabular-nums">{f.taka(sale.total)}</dd>
            {sale.payments.map((payment) => (
              <div key={payment.id} className="contents">
                <dt>
                  {t.paid} · {payment.account ?? t.methods[payment.method as keyof typeof t.methods] ?? payment.method}
                </dt>
                <dd className="text-right tabular-nums">{f.taka(payment.amount)}</dd>
              </div>
            ))}
            {settledLater > 0 ? (
              <>
                <dt>{t.later}</dt>
                <dd className="text-right tabular-nums">{f.taka(settledLater.toFixed(2))}</dd>
              </>
            ) : null}
            <dt className="font-semibold">{t.change}</dt>
            <dd className="text-right font-semibold tabular-nums">{f.taka(sale.owed)}</dd>
            {sale.customerDue !== "0.00" ? (
              <>
                <dt>{t.owes}</dt>
                <dd className="text-right tabular-nums">{f.taka(sale.customerDue)}</dd>
              </>
            ) : null}
          </dl>
        </div>
        {thermal ? <p className="text-[11px]">{takaInWords(sale.total, lang)}</p> : null}
      </PrintSheet>
      <div className="space-y-3 print:hidden">
        <DataTable
          caption={s("sales.caption")}
          columns={[
            { key: "sku", header: s("sales.sku"), cell: (row) => row.sku },
            { key: "name", header: s("sales.product"), cell: (row) => row.name },
            { key: "quantity", header: s("sales.quantity"), cell: (row) => page.qty(row.quantity) },
            { key: "price", header: s("sales.unitPrice"), cell: (row) => page.taka(row.unitPrice) },
            { key: "total", header: s("sales.lineTotal"), cell: (row) => page.taka(row.lineTotal) },
          ]}
          rows={sale.items}
          getRowKey={(row) => row.id}
        />
        <p className="text-sm text-muted">
          {s("sales.statusLine", { status: sale.paymentStatus === "PAID" ? s("sales.PAID") : sale.paymentStatus === "PARTIAL" ? s("sales.PARTIAL") : sale.paymentStatus === "UNPAID" ? s("sales.UNPAID") : sale.paymentStatus, owed: page.taka(sale.owed), received: page.taka(sale.received), journal: sale.journalBalanced ? s("sales.balanced") : s("sales.unbalanced") })}
        </p>
      </div>
    </div>
  );
}
