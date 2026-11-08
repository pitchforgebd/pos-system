import { SalesTable } from "@/components/sales/sales-table";
import { Pagination } from "@/components/ui/pagination";
import { pageHref, type PageInfo } from "@/core/list";

type Row = Parameters<typeof SalesTable>[0]["rows"][number];

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
          hrefFor={(target) => pageHref(path, { ...params, pageSize: page.pageSize === 25 ? undefined : page.pageSize }, target)}
        />
      ) : null}
    </div>
  );
}
