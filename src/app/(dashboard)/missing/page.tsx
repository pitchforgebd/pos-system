

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export const generateMetadata = phraseTitled("Not found");

export default async function MissingPage() {
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
