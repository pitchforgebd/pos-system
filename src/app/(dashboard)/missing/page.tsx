import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Not found",
};

export default function MissingPage() {
  return (
    <EmptyState
      title="Page not found"
      description="That screen is not part of this application."
      action={
        <Button href="/dashboard" variant="secondary">
          Back to dashboard
        </Button>
      }
    />
  );
}
