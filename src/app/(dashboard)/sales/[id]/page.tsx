import { notFound, redirect } from "next/navigation";

import { PrintButton, PrintSheet } from "@/components/print/sheet";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getSale } from "@/modules/sales/sales";

export const metadata = { title: "Sale" };

export default async function SaleDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={sale.number ?? "Sale"}
        description={`${sale.customerName} · ${sale.businessDate} · ${sale.total}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales", href: "/sales" }, { label: sale.number ?? "Sale" }]}
        actions={
          <div className="flex gap-2 print:hidden">
            <PrintButton label={query.print === "thermal" ? "Print thermal receipt" : "Print A4 invoice"} />
            <a className="text-sm underline" href={query.print === "thermal" ? `/sales/${sale.id}` : `/sales/${sale.id}?print=thermal`}>
              {query.print === "thermal" ? "A4 invoice" : "Thermal receipt"}
            </a>
          </div>
        }
      />
      <PrintSheet title={query.print === "thermal" ? "Receipt" : "Invoice"} note={query.print === "thermal" ? "80mm" : "A4"} thermal={query.print === "thermal"}>
        <p>Invoice {sale.number ?? "Sale"}</p>
        <p>Date {sale.businessDate}</p>
        <p>Customer {sale.customerName}</p>
        {sale.items.map((item) => (
          <p key={item.id}>
            {item.name} · {item.quantity} · {item.unitPrice} · {item.lineTotal}
          </p>
        ))}
        <p>Discount {sale.discountTotal}</p>
        <p>VAT {sale.vatTotal}</p>
        <p>Charges {sale.chargesTotal}</p>
        <p>Total {sale.total}</p>
        {sale.payments.map((payment) => (
          <p key={payment.id}>
            {payment.method} {payment.amount}
          </p>
        ))}
      </PrintSheet>
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
        Discount {sale.discountTotal}, VAT {sale.vatTotal}, charges {sale.chargesTotal}. Cash paid{" "}
        {sale.payments.map((payment) => payment.amount).join(", ") || "0.00"}. Journal {sale.journalBalanced ? "is balanced" : "is not balanced"}.
      </p>
      <p className="text-sm text-muted">
        Payment status {sale.paymentStatus}. Owed {sale.owed}, received since the sale {sale.received}.
      </p>
    </div>
  );
}
