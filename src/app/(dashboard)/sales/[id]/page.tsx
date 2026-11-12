import { notFound, redirect } from "next/navigation";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getSale } from "@/modules/sales/sales";

export const metadata = { title: "Sale" };

// What the invoice says, in the language the cashier chose (?lang=bn or en) and on the paper the shop prints on (?print=thermal for 80 mm).
const WORDS = {
  en: { invoice: "Invoice", receipt: "Receipt", date: "Date", customer: "Customer", level: "Price level", item: "Item", qty: "Qty", price: "Price", total: "Total", goods: "Goods", discount: "Discount", vat: "VAT", charges: "Charges", paid: "Paid", change: "Still owed on this invoice", owes: "Total due from the customer now", status: "Status", thanks: "Thank you" },
  bn: { invoice: "ইনভয়েস", receipt: "রসিদ", date: "তারিখ", customer: "কাস্টমার", level: "দামের লেভেল", item: "পণ্য", qty: "পরিমাণ", price: "দাম", total: "মোট", goods: "পণ্যের মূল্য", discount: "ছাড়", vat: "ভ্যাট", charges: "চার্জ", paid: "পরিশোধ", change: "এই ইনভয়েসে বাকি", owes: "কাস্টমারের মোট বাকি এখন", status: "অবস্থা", thanks: "ধন্যবাদ" },
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
  const t = WORDS[query.lang === "bn" ? "bn" : "en"];
  const link = (print: boolean, lang: "bn" | "en") => `/sales/${sale.id}?${print ? "print=thermal&" : ""}lang=${lang}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={sale.number ?? "Sale"}
        description={`${sale.customerName} · ${sale.businessDate} · ${sale.total}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales", href: "/sales" }, { label: sale.number ?? "Sale" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="secondary" href="/pos">
              New sale
            </Button>
            <PrintButton label={thermal ? "Print 80mm receipt" : "Print A4 invoice"} />
            <a className="text-sm underline" href={link(!thermal, query.lang === "bn" ? "bn" : "en")}>
              {thermal ? "A4 invoice" : "80mm receipt"}
            </a>
            <a className="text-sm underline" href={link(thermal, query.lang === "bn" ? "en" : "bn")}>
              {query.lang === "bn" ? "English" : "বাংলা"}
            </a>
          </div>
        }
      />
      <PrintSheet title={thermal ? t.receipt : t.invoice} note={thermal ? "80mm" : "A4"} thermal={thermal}>
        <p>
          {t.invoice} {sale.number ?? "Sale"} · {t.date} {sale.businessDate}
        </p>
        <p>
          {t.customer}: {sale.customerName}
          {sale.priceLevel ? ` · ${t.level}: ${sale.priceLevel}` : ""}
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-0.5">{t.item}</th>
              <th className="py-0.5 text-right">{t.qty}</th>
              <th className="py-0.5 text-right">{t.price}</th>
              <th className="py-0.5 text-right">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item) => (
              <tr key={item.id}>
                <td className="py-0.5">{item.name}</td>
                <td className="py-0.5 text-right tabular-nums">{item.quantity}</td>
                <td className="py-0.5 text-right tabular-nums">{item.unitPrice}</td>
                <td className="py-0.5 text-right tabular-nums">{item.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-4 text-sm">
          <dt>{t.goods}</dt>
          <dd className="text-right tabular-nums">{sale.subtotal}</dd>
          <dt>{t.discount}</dt>
          <dd className="text-right tabular-nums">{sale.discountTotal}</dd>
          <dt>{t.vat}</dt>
          <dd className="text-right tabular-nums">{sale.vatTotal}</dd>
          <dt>{t.charges}</dt>
          <dd className="text-right tabular-nums">{sale.chargesTotal}</dd>
          <dt className="font-semibold">{t.total}</dt>
          <dd className="text-right font-semibold tabular-nums">{sale.total}</dd>
          {sale.payments.map((payment) => (
            <div key={payment.id} className="contents">
              <dt>
                {t.paid} ({payment.method})
              </dt>
              <dd className="text-right tabular-nums">{payment.amount}</dd>
            </div>
          ))}
          <dt>{t.change}</dt>
          <dd className="text-right tabular-nums">{sale.owed}</dd>
          {sale.customerDue !== "0.00" ? (
            <>
              <dt>{t.owes}</dt>
              <dd className="text-right tabular-nums">{sale.customerDue}</dd>
            </>
          ) : null}
        </dl>
        <p className="text-center">{t.thanks}</p>
      </PrintSheet>
      <div className="space-y-3 print:hidden">
        <DataTable
          caption="Sale lines"
          columns={[
            { key: "sku", header: "SKU", cell: (row) => row.sku },
            { key: "name", header: "Product", cell: (row) => row.name },
            { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
            { key: "price", header: "Unit price", cell: (row) => row.unitPrice },
            { key: "total", header: "Line total", cell: (row) => row.lineTotal },
          ]}
          rows={sale.items}
          getRowKey={(row) => row.id}
        />
        <p className="text-sm text-muted">
          Payment status {sale.paymentStatus}. Owed {sale.owed}, received {sale.received}. Journal {sale.journalBalanced ? "is balanced" : "is not balanced"}.
        </p>
      </div>
    </div>
  );
}
