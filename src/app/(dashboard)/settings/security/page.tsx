import { redirect } from "next/navigation";

import { IdleTimeoutForm } from "@/components/settings/security-form";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getSecuritySettings, IDLE_MAX_MINUTES, IDLE_MIN_MINUTES } from "@/modules/settings/security";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Security settings");

export default async function SecuritySettingsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const settings = await getSecuritySettings(session.organizationId);
  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Security settings")}
        description={ph("How long a signed-in user may do nothing before being signed out.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Settings", href: "/settings" }, { label: ph("Security") }]}
      />
      <section className="space-y-3" aria-label={ph("Idle sign-out")}>
        <h2 className="text-lg font-semibold">{ph("Idle sign-out")}</h2>
        <IdleTimeoutForm minutes={settings.idleTimeoutMinutes} min={IDLE_MIN_MINUTES} max={IDLE_MAX_MINUTES} />
      </section>
    </div>
  );
}
