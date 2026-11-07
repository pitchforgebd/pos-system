import { notFound, redirect } from "next/navigation";

import { ConvertQuotation, StatusAction } from "@/components/commerce/forms";
import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getQuotation } from "@/modules/commerce/quotations";

export const metadata = { title: "Quotation" };

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const quotation = await getQuotation(session.organizationId, session.branchId, id);
  if (!quotation) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={quotation.number}
        description={`${quotation.customerName} · ${quotation.businessDate} · ${quotation.status}. A line converts into a due sale at the quoted unit price.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Quotations", href: "/quotations" }, { label: quotation.number }]}
        actions={<PrintButton label="Print quotation" />}
      />
      <PrintSheet title="Quotation" note={quotation.items.length ? "Quoted lines" : "No product line is stored."}>
        <p>{quotation.number}</p>
        <p>{quotation.customerName}</p>
        <p>{quotation.businessDate}</p>
        <p>{quotation.status}</p>
        {quotation.note ? <p>{quotation.note}</p> : null}
      </PrintSheet>
      {quotation.note ? <p className="text-sm">{quotation.note}</p> : null}
      {quotation.items.length ? (
        <ul className="space-y-1 text-sm">
          {quotation.items.map((item) => (
            <li key={`${item.sku}-${item.unitPrice}`}>
              {item.sku} · {item.name} · {item.quantity} × {item.unitPrice} = {item.lineTotal}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        {quotation.status === "DRAFT" ? <StatusAction url={`/api/v1/quotations/${quotation.id}/send`} label="Send" /> : null}
        {quotation.status === "SENT" ? <StatusAction url={`/api/v1/quotations/${quotation.id}/accept`} label="Accept" /> : null}
        {quotation.items.length && !quotation.saleId && session.permissions.has("sales.create") ? <ConvertQuotation id={quotation.id} /> : null}
        {quotation.saleId ? <p className="text-sm">Sale {quotation.saleId}</p> : null}
      </div>
    </div>
  );
}
