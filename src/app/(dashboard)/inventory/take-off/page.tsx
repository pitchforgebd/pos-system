import Link from "next/link";
import { redirect } from "next/navigation";

import { TakeOffForm } from "@/components/inventory/stock-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listProducts } from "@/modules/catalog/products";
import { getSession } from "@/modules/auth/current-session";
import { listTakeOffs } from "@/modules/inventory/documents";

export const metadata = { title: "Take-off" };

const PURPOSE_LABEL: Record<string, string> = {
  SAMPLE: "Sample",
  DEMO: "Demonstration",
  FIELD_TRIAL: "Field trial",
  OWN_USE: "Own use (drawing)",
  GIFT: "Gift",
};

export default async function TakeOffPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const canPost = session.permissions.has("inventory.takeoff");
  const [products, records] = await Promise.all([
    canPost ? listProducts(session.organizationId) : Promise.resolve([]),
    listTakeOffs(session.organizationId, session.branchId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Take-off"
        description="Goods that leave the warehouse without a sale: samples, demonstrations, field trials, the owner's own use, gifts. They leave stock at their average cost. Own use is a drawing; the other reasons are an expense."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Inventory", href: "/inventory" }, { label: "Take-off" }]}
      />
      {canPost ? <TakeOffForm products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))} /> : null}
      <h2 className="text-lg font-semibold">All take-offs</h2>
      <DataTable
        caption="Take-offs"
        columns={[
          { key: "number", header: "Number", cell: (row) => <Link href={`/inventory/take-off/${row.id}`}>{row.number}</Link> },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "purpose", header: "Why", cell: (row) => PURPOSE_LABEL[row.purpose ?? ""] ?? row.purpose },
          { key: "items", header: "Goods", cell: (row) => row.items.map((item) => `${item.name} × ${item.quantity}`).join(", ") },
          { key: "recipient", header: "Given to", cell: (row) => row.recipient },
          { key: "approvedBy", header: "Approved by", cell: (row) => row.approvedBy },
          { key: "value", header: "Value (avg cost)", cell: (row) => row.value },
        ]}
        rows={records}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No take-offs" description="A saved take-off reduces stock and appears here." />}
      />
    </div>
  );
}
