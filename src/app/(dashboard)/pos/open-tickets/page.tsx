import { redirect } from "next/navigation";

import { TicketList } from "@/components/sales/ticket-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listHeldTickets } from "@/modules/sales/tickets";

export const metadata = { title: "Open tickets" };

export default async function OpenTicketsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const tickets = await listHeldTickets(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Open tickets"
        description="A held ticket does not reserve stock and does not post a journal."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Register", href: "/pos" }, { label: "Open tickets" }]}
        actions={
          <Button href="/pos" variant="secondary">
            Back to register
          </Button>
        }
      />
      {tickets.length === 0 ? (
        <EmptyState title="No open tickets" description="Hold a cart on the register when the customer is not ready to pay." />
      ) : (
        <TicketList tickets={tickets} canDiscard={session.permissions.has("sales.create")} />
      )}
    </div>
  );
}
