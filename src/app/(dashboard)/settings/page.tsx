import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/settings/profile-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { listBranches } from "@/modules/access/users";
import { getSession } from "@/modules/auth/current-session";
import { getOrganizationProfile } from "@/modules/settings/profile";
import { getSmsSettings } from "@/modules/sms/sms";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Settings");

export default async function SettingsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [profile, branches, sms] = await Promise.all([
    getOrganizationProfile(session.organizationId),
    listBranches(session.organizationId),
    getSmsSettings(session.organizationId),
  ]);
  if (!profile) {
    redirect("/login");
  }
  const sellBranch = branches.find((branch) => branch.id === session.branchId)?.name ?? "No branch selected";

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Settings")}
        description={ph("Shop name, phone, address, BIN, TIN, logo address, and loyalty rates.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Settings") }]}
      />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{ph("Shop profile")}</h2>
        {profile.logoUrl ? <img src={profile.logoUrl} alt={ph("Shop logo")} className="h-12 w-auto" /> : null}
        {session.permissions.has("settings.manage") ? (
          <ProfileForm
            name={profile.name}
            phone={profile.phone}
            address={profile.address}
            bin={profile.bin}
            tin={profile.tin}
            logoUrl={profile.logoUrl}
            pointsPerHundred={profile.pointsPerHundred}
            takaPerPoint={profile.takaPerPoint}
          />
        ) : null}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{ph("Sell branch")}</h2>
        <p className="text-sm text-muted">{ph("The sell branch is the branch on this session:")} {sellBranch}{ph(". Change it from the header. A separate default is not stored.")}</p>
        {session.permissions.has("branches.manage") ? (
          <Link href="/branches" className="text-sm font-medium text-primary">
            {ph("Create a branch")}
          </Link>
        ) : null}
        <DataTable
          caption={ph("Branches")}
          columns={[
            { key: "name", header: ph("Branch"), cell: (row) => row.name },
            { key: "current", header: ph("Session"), cell: (row) => (row.id === session.branchId ? "Current" : "") },
          ]}
          rows={branches}
          getRowKey={(row) => row.id}
        />
      </section>
      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-semibold">{ph("SMS")}</h2>
        <p>{ph("Sender")} {sms.sender ?? ph("not set")}</p>
        <p>{ph("Provider")} {sms.provider ?? ph("not set")}</p>
        <p>
          <Link href="/sms/settings">{ph("SMS Settings")}</Link>
        </p>
      </section>
    </div>
  );
}
