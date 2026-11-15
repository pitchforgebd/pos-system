import { redirect } from "next/navigation";

import { SmsMetrics } from "@/components/sms/metrics";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { smsDashboard } from "@/modules/sms/sms";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("SMS dashboard");

export default async function SmsDashboardPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const figures = await smsDashboard(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("SMS dashboard")}
        description={ph("Sent counts use UTC. What is left on the SMS account is what the provider says, when it can say.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: ph("Dashboard") }]}
        actions={<Button href="/sms/send">{ph("Send SMS")}</Button>}
      />
      <SmsMetrics figures={figures} />
    </div>
  );
}
