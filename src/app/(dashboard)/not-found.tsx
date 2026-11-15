import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { getPhrase } from "@/lib/i18n/server";

export default async function DashboardNotFound() {
  const ph = await getPhrase();
  return (
    <EmptyState
      title={ph("Page not found")}
      description={ph("That screen is not part of this application.")}
      action={
        <Button href="/dashboard" variant="secondary">
          {ph("Back to dashboard")}
        </Button>
      }
    />
  );
}
