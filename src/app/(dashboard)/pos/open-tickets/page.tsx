import { redirect } from "next/navigation";

import { TicketList } from "@/components/sales/ticket-list";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { titled } from "@/lib/i18n/metadata";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { listHeldTickets } from "@/modules/sales/tickets";

export const generateMetadata = titled("sales", "sales.ticketsTitle");

export default async function OpenTicketsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { t } = await getI18n("sales");
  const tickets = await listHeldTickets(session.organizationId, session.branchId);

  return (
    <I18nBoundary areas={["sales"]}>
      <div className="space-y-6">
        <PageHeader
          title={t("sales.ticketsTitle")}
          description={t("sales.ticketsDescription")}
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Register", href: "/pos" }, { label: "Open tickets" }]}
          actions={
            <Button href="/pos" variant="secondary">
              {t("sales.ticketsBack")}
            </Button>
          }
        />
        {tickets.length === 0 ? (
          <EmptyState title={t("sales.ticketsEmptyTitle")} description={t("sales.ticketsEmptyBody")} />
        ) : (
          <TicketList tickets={tickets} canDiscard={session.permissions.has("sales.create")} />
        )}
      </div>
    </I18nBoundary>
  );
}
