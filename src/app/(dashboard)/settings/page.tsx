import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/settings/profile-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { listBranches } from "@/modules/access/users";
import { getSession } from "@/modules/auth/current-session";
import { getOrganizationProfile } from "@/modules/settings/profile";
import { getSmsSettings } from "@/modules/sms/sms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
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
        title="Settings"
        description="Shop name, phone, address, BIN, TIN, logo address, and loyalty rates."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Settings" }]}
      />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Shop profile</h2>
        {profile.logoUrl ? <img src={profile.logoUrl} alt="Shop logo" className="h-12 w-auto" /> : null}
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
        <h2 className="text-lg font-semibold">Sell branch</h2>
        <p className="text-sm text-muted">The sell branch is the branch on this session: {sellBranch}. Change it from the header. A separate default is not stored.</p>
        {session.permissions.has("branches.manage") ? (
          <Link href="/branches" className="text-sm font-medium text-primary">
            Create a branch
          </Link>
        ) : null}
        <DataTable
          caption="Branches"
          columns={[
            { key: "name", header: "Branch", cell: (row) => row.name },
            { key: "current", header: "Session", cell: (row) => (row.id === session.branchId ? "Current" : "") },
          ]}
          rows={branches}
          getRowKey={(row) => row.id}
        />
      </section>
      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-semibold">SMS</h2>
        <p>Sender {sms.sender ?? "not set"}</p>
        <p>Provider {sms.provider ?? "not set"}</p>
        <p>
          <Link href="/sms/settings">SMS Settings</Link>
        </p>
      </section>
    </div>
  );
}
