import { Skeleton } from "@/components/ui/skeleton";
import { getI18n } from "@/lib/i18n/server";

/** What a heavy list or report shows while its data is being made: a title, a row of filters and a table, so the page does not jump when it arrives (U1). */
export default async function ListLoading() {
  const { t } = await getI18n();
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <p className="sr-only">{t("common.loading")}</p>
      <Skeleton className="h-8 w-56" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="space-y-2 rounded-md border border-border bg-surface p-3">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
