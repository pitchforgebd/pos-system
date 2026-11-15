import Link from "next/link";
import { redirect } from "next/navigation";

import { QuickCustomerForm } from "@/components/parties/party-forms";
import { Register, type RegisterInitial } from "@/components/pos/register";
import { Alert } from "@/components/ui/alert";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { listCategories } from "@/modules/catalog/references";
import { listPriceLevels } from "@/modules/pricing/admin";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { getHeldTicket } from "@/modules/sales/tickets";
import { geography } from "@/modules/parties/profile";
import { activeShiftOf, shiftRequired } from "@/modules/shifts/shifts";

export async function generateMetadata() {
  return { title: (await getI18n()).t("shell.sell") };
}

export default async function PosPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const { t } = await getI18n("pos", "customers");
  const [accounts, categories, levels, ticket, needShift, myShift, places] = await Promise.all([
    moneyAccountOptions(session.organizationId),
    listCategories(session.organizationId),
    listPriceLevels(session.organizationId),
    params.ticket && /^[0-9a-f-]{36}$/i.test(params.ticket) ? getHeldTicket(session.organizationId, session.branchId, params.ticket) : Promise.resolve(null),
    shiftRequired(session.organizationId),
    activeShiftOf(session.organizationId, session.branchId, session.userId),
    geography(),
  ]);
  const branchName = session.branches.find((branch) => branch.id === session.branchId)?.name ?? t("pos.branchFallback");
  const initial: RegisterInitial = ticket ? { ticketId: ticket.id, customer: ticket.customer, lines: ticket.lines, warnings: ticket.warnings } : null;

  return (
    <div className="space-y-4">
      {needShift && !myShift ? (
        <Alert tone="warning" title={t("pos.shiftTitle")}>
          {t("pos.shiftBody")} <Link href="/shifts">{t("pos.openShift")}</Link>
        </Alert>
      ) : null}
      {session.permissions.has("sales.create") ? (
        <I18nBoundary areas={["pos"]}>
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
        </I18nBoundary>
      ) : null}
      {session.permissions.has("customers.create") ? (
        <I18nBoundary areas={["customers"]}>
          <QuickCustomerForm places={places} />
        </I18nBoundary>
      ) : null}
    </div>
  );
}
