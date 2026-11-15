import { notFound, redirect } from "next/navigation";

import { PartyStatement } from "@/components/parties/statement";
import { PageHeader } from "@/components/ui/page-header";
import { addDays, businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { statementOf } from "@/modules/customers/profile";

export const metadata = { title: "Statement" };

const iso = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const query = await searchParams;
  const to = iso(query.to) ?? businessDate();
  const from = iso(query.from) ?? addDays(to, -90);
  const statement = /^[0-9a-f-]{36}$/i.test(id) ? await statementOf(session.organizationId, "CUSTOMER", id, from <= to ? from : to, to) : null;
  if (!statement) {
    notFound();
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Statement: ${statement.party.name}`}
        description="Every line of the account in the period, with the balance after each. Print it or send it to the customer."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: statement.party.name, href: `/customers/${id}` }, { label: "Statement" }]}
      />
      <PartyStatement statement={statement} kind="customer" back={`/customers/${id}`} />
    </div>
  );
}
