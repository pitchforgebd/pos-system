import { SalesTable } from "@/components/sales/sales-table";
import { Pagination } from "@/components/ui/pagination";
import type { PageInfo } from "@/core/list";

type Row = Parameters<typeof SalesTable>[0]["rows"][number];

/** The query parameters every page link keeps: the ones the page has, and the page size when it is not the default. */
function linkParams(params: Record<string, unknown>, page: PageInfo) {
  const kept: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value !== "") {
      kept[key] = value;
    }
  }
  if (page.pageSize !== 25) {
    kept.pageSize = page.pageSize;
  }
  return kept;
}

/** The sales table with its pager. `path` is the page's own path; `params` are its other query parameters (kept on every page link). */
export function SalesList({ rows, page, path, params }: { rows: Row[]; page: PageInfo; path: string; params: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <SalesTable rows={rows} />
      {page.total > page.pageSize ? (
        <Pagination
          page={page.page}
          pageCount={page.pageCount}
          total={page.total}
          pageSize={page.pageSize}
          path={path}
          params={linkParams(params, page)}
        />
      ) : null}
    </div>
  );
}
