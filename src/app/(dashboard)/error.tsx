"use client";

import { ErrorState } from "@/components/ui/states";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="This page failed to load"
      description="The screen could not be shown. Nothing was changed."
      onRetry={reset}
    />
  );
}
