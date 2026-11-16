import { redirect } from "next/navigation";

import { PartyAmountForm } from "@/components/customers/party-search";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { listSuppliers } from "@/modules/purchasing/suppliers";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Supplier payment");

export default async function SupplierPaymentsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const suppliers = session.permissions.has("suppliers.payment") ? await listSuppliers(session.organizationId) : [];
  const accounts = (await moneyAccountOptions(session.organizationId)).filter((row) => row.kind !== "CASH").map((row) => ({ id: row.id, label: `${row.code} · ${row.name}`, kind: row.kind }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Supplier payment")}
        description={ph("Search by name or phone, then pay from cash or from one of your bank or mobile accounts. The payment cannot exceed what is owed; for a charge, for named bills, or to pay ahead, use the vendor's page.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: ph("Payment") }]}
      />
      {session.permissions.has("suppliers.payment") ? (
        <PartyAmountForm
          title={ph("Pay the vendor")}
          accounts={accounts}
          url="/api/v1/suppliers/:id/payments"
          mode="due"
          balanceLabel="Payable"
          parties={suppliers
            .filter((supplier) => supplier.status === "ACTIVE")
            .map((supplier) => ({ id: supplier.id, name: supplier.name, phone: supplier.phone, outstanding: supplier.outstanding }))}
        />
      ) : null}
    </div>
  );
}
