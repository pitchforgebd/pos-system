"use client";

import { Button } from "@/components/ui/button";
import { pageHref } from "@/core/list";

type PaginationProps = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
} & (
  | {
      /** Client-side list: the parent holds the page in state. */
      onPageChange: (page: number) => void;
      path?: never;
      params?: never;
    }
  | {
      /**
       * Server-side list: every page is a link (so the page works without JavaScript and can be shared). `path` is the page's
       * own path and `params` its other query parameters, kept on every link. Plain data, not a function: a server page cannot
       * hand a function to a client component.
       */
      path: string;
      params?: Record<string, string | number>;
      onPageChange?: never;
    }
);

export function Pagination({ page, pageCount, total, pageSize, onPageChange, path, params }: PaginationProps) {
  // A page past the last one (an old link, a typed number) shows nothing, and Previous goes back to the last real page.
  const pastEnd = page > pageCount;
  const start = total === 0 || pastEnd ? 0 : (page - 1) * pageSize + 1;
  const end = pastEnd ? 0 : Math.min(page * pageSize, total);
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  function control(label: string, target: number, enabled: boolean) {
    if (path !== undefined) {
      return enabled ? (
        <Button variant="secondary" size="sm" href={pageHref(path, params ?? {}, target)}>
          {label}
        </Button>
      ) : (
        <Button variant="secondary" size="sm" disabled>
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
