import { redirect } from "next/navigation";

import { SmsMetrics } from "@/components/sms/metrics";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { smsDashboard } from "@/modules/sms/sms";

export const metadata = { title: "SMS dashboard" };

export default async function SmsDashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const figures = await smsDashboard(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="SMS dashboard"
        description="Sent counts use UTC. This shop does not buy SMS credit inside the app."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: "Dashboard" }]}
        actions={<Button href="/sms/send">Send SMS</Button>}
      />
      <SmsMetrics figures={figures} />
    </div>
  );
}
