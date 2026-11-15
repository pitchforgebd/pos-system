import { redirect } from "next/navigation";

import { IdleTimeoutForm } from "@/components/settings/security-form";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getSecuritySettings, IDLE_MAX_MINUTES, IDLE_MIN_MINUTES } from "@/modules/settings/security";

export const metadata = { title: "Security settings" };

export default async function SecuritySettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const settings = await getSecuritySettings(session.organizationId);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Security settings"
        description="How long a signed-in user may do nothing before being signed out."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Settings", href: "/settings" }, { label: "Security" }]}
      />
      <section className="space-y-3" aria-label="Idle sign-out">
        <h2 className="text-lg font-semibold">Idle sign-out</h2>
        <IdleTimeoutForm minutes={settings.idleTimeoutMinutes} min={IDLE_MIN_MINUTES} max={IDLE_MAX_MINUTES} />
      </section>
    </div>
  );
}
