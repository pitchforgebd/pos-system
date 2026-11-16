import Link from "next/link";
import { redirect } from "next/navigation";

import { TakeOffForm } from "@/components/inventory/stock-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listProducts } from "@/modules/catalog/products";
import { getSession } from "@/modules/auth/current-session";
import { listTakeOffs } from "@/modules/inventory/documents";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Take-off");

const PURPOSE_LABEL: Record<string, string> = {
  SAMPLE: "Sample for a customer",
  DEMO: "Demonstration",
  FIELD_TRIAL: "Field trial",
  OWN_USE: "Owner's own use (a drawing)",
  GIFT: "Gift",
};

export default async function TakeOffPage() {
  const ph = await getPhrase();
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
        title={ph("Take-off")}
        description={ph("Goods that leave the warehouse without a sale: samples, demonstrations, field trials, the owner's own use, gifts. They leave stock at their average cost. Own use is a drawing; the other reasons are an expense.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Inventory", href: "/inventory" }, { label: ph("Take-off") }]}
      />
      {canPost ? <TakeOffForm products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))} /> : null}
      <h2 className="text-lg font-semibold">{ph("All take-offs")}</h2>
      <DataTable
        caption={ph("Take-offs")}
        columns={[
          { key: "number", header: ph("Number"), cell: (row) => <Link href={`/inventory/take-off/${row.id}`}>{row.number}</Link> },
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "purpose", header: ph("Why"), cell: (row) => ph(PURPOSE_LABEL[row.purpose ?? ""] ?? row.purpose ?? "") },
          { key: "items", header: ph("Goods"), cell: (row) => row.items.map((item) => `${item.name} × ${item.quantity}`).join(", ") },
          { key: "recipient", header: ph("Given to"), cell: (row) => row.recipient },
          { key: "approvedBy", header: ph("Approved by"), cell: (row) => row.approvedBy },
          { key: "value", header: ph("Value (avg cost)"), cell: (row) => row.value },
        ]}
        rows={records}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No take-offs")} description={ph("A saved take-off reduces stock and appears here.")} />}
      />
    </div>
  );
}
