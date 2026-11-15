import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/shell";
import { Sidebar } from "@/components/layout/sidebar";
import { PermissionDenied } from "@/components/ui/states";
import { referenceHrefs } from "@/constants/reference-nav";
import { prisma } from "@/lib/db/client";
import { getI18n } from "@/lib/i18n/server";
import { decidePageAccess } from "@/modules/access/route-access";
import { getSession } from "@/modules/auth/current-session";
import { lowStockCount } from "@/modules/inventory/alerts";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const headerStore = await headers();
  if (headerStore.get("x-meridian-missing") === "1") {
    notFound();
  }
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const pathname = headerStore.get("x-pathname") ?? "/dashboard";
  const allowed = referenceHrefs().filter((href) => decidePageAccess(href, session.permissions) === "allow");
  const organization = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { name: true, logoUrl: true },
  });
  const { lang, t } = await getI18n();
  // The count beside Stock Alert Quantity: rows at or below their reorder level on this branch.
  const badges: Record<string, number> =
    session.branchId && session.permissions.has("inventory.view") ? { "/inventory/alerts": await lowStockCount(session.organizationId, session.branchId) } : {};

  const denied = decidePageAccess(pathname, session.permissions) === "forbidden";

  return (
    <AppShell
      sidebar={
        <Sidebar
          allowed={allowed}
          badges={badges}
          lang={lang}
          logoUrl={organization?.logoUrl ?? ""}
          organizationName={organization?.name ?? t("shell.shop")}
          branchName={session.branches.find((item) => item.id === session.branchId)?.name ?? session.branches[0]?.name ?? t("shell.noBranch")}
        />
      }
      allowed={allowed}
      badges={badges}
      lang={lang}
      session={{
        name: session.name,
        organizationName: organization?.name ?? t("shell.shop"),
        branches: session.branches,
        branchId: session.branchId,
      }}
    >
      {denied ? <PermissionDenied description={t("common.permissionBody")} title={t("common.permissionTitle")} /> : children}
    </AppShell>
  );
}
