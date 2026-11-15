import type { ReactNode } from "react";

import { getPhrase } from "@/lib/i18n/server";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
};

export async function DataTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  status = "ready",
  sortKey,
  sortDirection,
  onSort,
  empty,
  error,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  status?: "ready" | "loading" | "error";
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
  empty?: ReactNode;
  error?: ReactNode;
}) {
  // a header, a caption and a text cell are English sentences or words (a status, a method): they are shown in the language of the screen
  const ph = await getPhrase();
  const cellOf = (column: Column<T>, row: T) => {
    const value = column.cell(row);
    return typeof value === "string" ? ph(value) : value;
  };
  if (status === "error") {
    return <>{error}</>;
  }

  if (status === "ready" && rows.length === 0) {
    return <>{empty}</>;
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-md border border-border bg-surface md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{ph(caption)}</caption>
          <thead className="bg-surface-muted text-left text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="px-3 py-2 font-medium">
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-text"
                      onClick={() => onSort(column.key)}
                    >
                      {ph(column.header)}
                      {sortKey === column.key ? (
                        <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      ) : null}
                    </button>
                  ) : (
                    ph(column.header)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {status === "loading"
              ? Array.from({ length: 5 }, (_, index) => (
                  <tr key={index} className="border-t border-border">
                    {columns.map((column) => (
                      <td key={column.key} className="px-3 py-3">
                        <div className="h-4 animate-pulse rounded-md bg-border" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr key={getRowKey(row)} className="border-t border-border">
                    {columns.map((column) => (
                      <td key={column.key} className="px-3 py-2.5 align-middle">
                        {cellOf(column, row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border bg-surface md:hidden">
        {status === "loading"
          ? Array.from({ length: 3 }, (_, index) => (
              <li key={index} className="p-3">
                <div className="h-16 animate-pulse rounded-md bg-border" />
              </li>
            ))
          : rows.map((row) => (
              <li key={getRowKey(row)} className="space-y-2 p-3">
                {columns.map((column) => (
                  <div key={column.key} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-muted">{ph(column.header)}</span>
                    <span className="text-right">{cellOf(column, row)}</span>
                  </div>
                ))}
              </li>
            ))}
      </ul>
    </>
  );
}
