import { redirect } from "next/navigation";

import { CustomerForm } from "@/components/pos/customer-form";
import { Register, type RegisterInitial } from "@/components/pos/register";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { listCategories } from "@/modules/catalog/references";
import { listPriceLevels } from "@/modules/pricing/admin";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { getHeldTicket } from "@/modules/sales/tickets";

export const metadata = { title: "Sell" };

export default async function PosPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const [accounts, categories, levels, ticket] = await Promise.all([
    moneyAccountOptions(session.organizationId),
    listCategories(session.organizationId),
    listPriceLevels(session.organizationId),
    params.ticket && /^[0-9a-f-]{36}$/i.test(params.ticket) ? getHeldTicket(session.organizationId, session.branchId, params.ticket) : Promise.resolve(null),
  ]);
  const branchName = session.branches.find((branch) => branch.id === session.branchId)?.name ?? "Branch";
  const initial: RegisterInitial = ticket ? { ticketId: ticket.id, customer: ticket.customer, lines: ticket.lines, warnings: ticket.warnings } : null;

  return (
    <div className="space-y-4">
      {session.permissions.has("sales.create") ? (
        <Register
          key={initial?.ticketId ?? "new"}
          today={businessDate()}
          branchName={branchName}
          initial={initial}
          accounts={accounts.map((account) => ({ id: account.id, label: `${account.name}`, kind: account.kind }))}
          categories={categories.filter((category) => category.status === "ACTIVE").map((category) => ({ id: category.id, name: category.name }))}
          levels={levels.filter((level) => level.status === "ACTIVE").map((level) => level.name)}
          canLevel={session.permissions.has("sales.price_level")}
          canDiscount={session.permissions.has("sales.discount")}
        />
      ) : null}
      {session.permissions.has("customers.create") ? <CustomerForm /> : null}
    </div>
  );
}
