import { redirect } from "next/navigation";

import { SettingsForm } from "@/components/sms/forms";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { getSmsSettings } from "@/modules/sms/sms";

export const metadata = { title: "SMS Settings" };

export default async function SmsSettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const settings = await getSmsSettings(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="SMS Settings"
        description="Sender name and provider label. Credentials stay out of this form."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: "Settings" }]}
      />
      <SettingsForm sender={settings.sender ?? ""} provider={settings.provider ?? ""} />
    </div>
  );
}
