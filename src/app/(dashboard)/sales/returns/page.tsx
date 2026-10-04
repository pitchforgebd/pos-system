import { redirect } from "next/navigation";

import { DirectReturnForm } from "@/components/reference/gap-forms";
import { ReturnForm } from "@/components/returns/return-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listProducts } from "@/modules/catalog/products";
import { listDirectReturns } from "@/modules/reference/extras";
import { listReturnableSaleLines, listSaleReturns } from "@/modules/sales/returns";

export const metadata = { title: "Sales returns" };

export default async function SalesReturnsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [lines, returns, products, directReturns] = await Promise.all([
    listReturnableSaleLines(session.organizationId, session.branchId),
    listSaleReturns(session.organizationId, session.branchId),
    listProducts(session.organizationId),
    listDirectReturns(session.organizationId, session.branchId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Returnable Product"
        description="Search a posted sale line, or post a direct return without an invoice. A direct return puts stock back at the average stock-in cost and refunds cash or bank."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales", href: "/sales" }, { label: "Returns" }]}
      />
      {session.permissions.has("sales.return") ? (
        <>
          <ReturnForm lines={lines.map((line) => ({ documentId: line.saleId, itemId: line.itemId, label: line.label }))} kind="sale" />
          <h2 className="text-lg font-semibold">Direct return</h2>
          <DirectReturnForm products={products.filter((product) => product.status === "ACTIVE").map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))} />
        </>
      ) : null}
      <h2 className="text-lg font-semibold">Returned Invoice</h2>
      <DataTable
        caption="Returned invoices"
        columns={[
          { key: "number", header: "Return", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "source", header: "Invoice", cell: (row) => row.source },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={returns}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No sales returns" description="Return a posted sale line. The quantity cannot exceed what is still eligible." />}
      />
      <h2 className="text-lg font-semibold">Direct returns</h2>
      <DataTable
        caption="Direct returns"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "product", header: "Product", cell: (row) => row.productName },
          { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
          { key: "refund", header: "Refund", cell: (row) => row.refundAmount },
          { key: "method", header: "Method", cell: (row) => row.method },
        ]}
        rows={directReturns}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No direct returns" description="A direct return needs a product that already has a stock-in cost." />}
      />
    </div>
  );
}
