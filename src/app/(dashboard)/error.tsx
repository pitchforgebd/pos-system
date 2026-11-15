"use client";

import { ErrorState } from "@/components/ui/states";
import { useI18n } from "@/lib/i18n/provider";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return <ErrorState title={t("common.failedTitle")} description={t("common.failedBody")} retryLabel={t("common.retry")} onRetry={reset} />;
}
