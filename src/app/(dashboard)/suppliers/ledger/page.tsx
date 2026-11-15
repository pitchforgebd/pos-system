import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listSuppliers } from "@/modules/purchasing/suppliers";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Supplier ledger");

export default async function SupplierLedgerPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const suppliers = await listSuppliers(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Supplier ledger")}
        description={ph("Open a supplier to see the credits and debits. Outstanding is credits minus debits.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: ph("Ledger") }]}
      />
      <DataTable
        caption={ph("Supplier balances")}
        columns={[
          { key: "name", header: ph("Supplier"), cell: (row) => row.name },
          { key: "outstanding", header: ph("Outstanding"), cell: (row) => row.outstanding },
        ]}
        rows={suppliers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No suppliers")} description={ph("Add a supplier to start a ledger.")} />}
      />
    </div>
  );
}
