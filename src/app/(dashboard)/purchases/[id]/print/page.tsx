import { notFound, redirect } from "next/navigation";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getPurchase } from "@/modules/purchasing/purchases";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Purchase order");

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
  const received = purchase.status === "RECEIVED";
  const title = `${received ? "Purchase" : "Purchase order"} ${purchase.number ?? ""}`.trim();

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases", href: "/purchases" }, { label: purchase.number ?? "Purchase", href: `/purchases/${id}` }, { label: ph("Print") }]}
        actions={<PrintButton label={ph("Print")} />}
      />
      <PrintSheet title={title} note={`${purchase.supplier.name} · ${purchase.businessDate}${purchase.supplierInvoiceNo ? ` · vendor's invoice ${purchase.supplierInvoiceNo}` : ""}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-1">{ph("Product")}</th>
              <th className="py-1 text-right">{ph("Quantity")}</th>
              <th className="py-1 text-right">{ph("Unit cost")}</th>
              <th className="py-1 text-right">{ph("Discount")}</th>
              <th className="py-1 text-right">{ph("VAT")}</th>
              <th className="py-1 text-right">{ph("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map((item) => (
              <tr key={item.id}>
                <td className="py-1">
                  {item.sku} · {item.name}
                </td>
                <td className="py-1 text-right tabular-nums">{item.quantity}</td>
                <td className="py-1 text-right tabular-nums">{item.unitCost}</td>
                <td className="py-1 text-right tabular-nums">{item.discount}</td>
                <td className="py-1 text-right tabular-nums">{item.vatAmount}</td>
                <td className="py-1 text-right tabular-nums">{item.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-4 text-sm">
          <dt>{ph("Goods")}</dt>
          <dd className="text-right tabular-nums">{purchase.subtotal}</dd>
          <dt>{ph("Discounts")}</dt>
          <dd className="text-right tabular-nums">{purchase.discountTotal}</dd>
          <dt>{ph("VAT")}</dt>
          <dd className="text-right tabular-nums">{purchase.vatTotal}</dd>
          <dt className="font-semibold">{ph("Total")}</dt>
          <dd className="text-right font-semibold tabular-nums">{purchase.total}</dd>
        </dl>
        {purchase.note ? <p>{purchase.note}</p> : null}
      </PrintSheet>
    </div>
  );
}
