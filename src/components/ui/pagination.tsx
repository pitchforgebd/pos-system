import { Button } from "@/components/ui/button";

type PaginationProps = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
} & (
  | {
      /** Client-side list: the parent holds the page in state. */
      onPageChange: (page: number) => void;
      hrefFor?: never;
    }
  | {
      /** Server-side list: every page is a link, so the page works without JavaScript and can be shared. See `pageHref` in @/core/list. */
      hrefFor: (page: number) => string;
      onPageChange?: never;
    }
);

export function Pagination({ page, pageCount, total, pageSize, onPageChange, hrefFor }: PaginationProps) {
  // A page past the last one (an old link, a typed number) shows nothing, and Previous goes back to the last real page.
  const pastEnd = page > pageCount;
  const start = total === 0 || pastEnd ? 0 : (page - 1) * pageSize + 1;
  const end = pastEnd ? 0 : Math.min(page * pageSize, total);
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  function control(label: string, target: number, enabled: boolean) {
    if (hrefFor && enabled) {
      return (
        <Button variant="secondary" size="sm" href={hrefFor(target)}>
          {label}
        </Button>
      );
    }
    return (
      <Button variant="secondary" size="sm" disabled={!enabled} onClick={() => onPageChange?.(target)}>
        {label}
      </Button>
    );
  }

  return (
    <nav aria-label="Pagination" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        Showing {start}–{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        {control("Previous", Math.min(page - 1, pageCount), hasPrevious)}
        <span className="text-sm tabular-nums text-muted">
          {page} / {pageCount}
        </span>
        {control("Next", page + 1, hasNext)}
      </div>
    </nav>
  );
}
