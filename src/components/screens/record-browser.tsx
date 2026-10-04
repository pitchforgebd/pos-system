"use client";

import { useMemo, useState } from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "@/constants/ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDisplayDate } from "@/lib/format/date";
import type { MockColumn, MockRow } from "@/lib/screens/types";

function badgeTone(value: string) {
  if (["Paid", "Active", "Received", "Approved", "Closed", "Sent", "Normal", "Accepted", "Fulfilled"].includes(value)) {
    return "success" as const;
  }
  if (["Partial", "Pending", "Draft", "Low", "Held", "Requested", "Closing"].includes(value)) {
    return "warning" as const;
  }
  if (["Due", "Overdue", "Expired", "Rejected", "Failed", "Out of stock", "Cancelled"].includes(value)) {
    return "error" as const;
  }
  return "neutral" as const;
}

function renderCell(column: MockColumn, row: MockRow, detailBase?: string) {
  const value = row[column.key];
  if (column.kind === "money" && typeof value === "number") {
    return <MoneyDisplay amount={value} />;
  }
  if (column.kind === "date" && typeof value === "string") {
    return formatDisplayDate(value);
  }
  if (column.kind === "badge" && typeof value === "string") {
    return <StatusBadge tone={badgeTone(value)}>{value}</StatusBadge>;
  }
  if (column.key === "id" && detailBase) {
    return (
      <Button href={`${detailBase}/${row.id}`} variant="ghost" size="sm">
        {String(value ?? "")}
      </Button>
    );
  }
  return String(value ?? "");
}

export function RecordBrowser({
  caption,
  columns,
  rows,
  view,
  detailBase,
  onRetry,
}: {
  caption: string;
  columns: MockColumn[];
  rows: MockRow[];
  view: "ready" | "loading" | "empty" | "error";
  detailBase?: string;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [branch, setBranch] = useState("all");
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const filterKey = `${debouncedQuery}|${status}|${branch}|${range.from ?? ""}|${range.to ?? ""}|${view}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  if (pageState.key !== filterKey) {
    setPageState({ key: filterKey, page: 1 });
  }

  const fieldId = caption.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const dateColumn = columns.find((column) => column.kind === "date");
  const statusColumn = columns.find((column) => column.kind === "badge");
  const branchColumn = columns.find((column) => column.key === "branch");
  const statuses = statusColumn ? [...new Set(rows.map((row) => String(row[statusColumn.key])))] : [];
  const branches = branchColumn ? [...new Set(rows.map((row) => String(row[branchColumn.key])))] : [];

  const filtered = useMemo(() => {
    const needle = debouncedQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = needle.length === 0 || Object.values(row).some((value) => String(value).toLowerCase().includes(needle));
      const matchesStatus = !statusColumn || status === "all" || String(row[statusColumn.key]) === status;
      const matchesBranch = !branchColumn || branch === "all" || String(row[branchColumn.key]) === branch;
      const rawDate = dateColumn ? String(row[dateColumn.key]) : "";
      const matchesFrom = !dateColumn || !range.from || rawDate >= range.from;
      const matchesTo = !dateColumn || !range.to || rawDate <= range.to;
      return matchesQuery && matchesStatus && matchesBranch && matchesFrom && matchesTo;
    });
  }, [branch, branchColumn, dateColumn, debouncedQuery, range.from, range.to, rows, status, statusColumn]);

  const page = pageState.page;
  const pageCount = Math.max(1, Math.ceil(filtered.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * DEFAULT_PAGE_SIZE, currentPage * DEFAULT_PAGE_SIZE);

  const tableColumns: Column<MockRow>[] = columns.map((column) => ({
    key: column.key,
    header: column.header,
    sortable: column.kind !== "badge",
    cell: (row) => renderCell(column, row, detailBase),
  }));

  if (view === "error") {
    return <ErrorState title="This list could not be shown" description="The sample list failed to render. Nothing was changed." onRetry={onRetry} />;
  }

  return (
    <div className="space-y-3">
      <FilterBar>
        <div className="min-w-48 flex-1">
          <FormField label="Search" htmlFor={`${fieldId}-search`}>
            <SearchInput id={`${fieldId}-search`} value={query} placeholder="Search sample rows" onChange={(event) => setQuery(event.target.value)} />
          </FormField>
        </div>
        {statusColumn ? (
          <div className="min-w-36">
            <FormField label="Status" htmlFor={`${fieldId}-status`}>
              <Select id={`${fieldId}-status`} value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All</option>
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        ) : null}
        {branchColumn ? (
          <div className="min-w-40">
            <FormField label="Branch" htmlFor={`${fieldId}-branch`}>
              <Select id={`${fieldId}-branch`} value={branch} onChange={(event) => setBranch(event.target.value)}>
                <option value="all">All branches</option>
                {branches.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        ) : null}
        {dateColumn ? (
          <div className="min-w-64">
            <FormField label="Date" htmlFor={`${fieldId}-dates`}>
              <DateRangePicker id={`${fieldId}-dates`} value={range} onChange={setRange} />
            </FormField>
          </div>
        ) : null}
      </FilterBar>
      {view === "empty" ? (
        <EmptyState title="No sample records" description="This screen has no rows in the empty preview." />
      ) : (
        <DataTable
          caption={caption}
          columns={tableColumns}
          rows={view === "loading" ? [] : visible}
          getRowKey={(row) => String(row.id)}
          status={view === "loading" ? "loading" : "ready"}
          empty={<EmptyState title="No matching sample rows" description="Nothing in this sample list matches the filters." />}
        />
      )}
      {view === "ready" ? (
        <Pagination
          page={currentPage}
          pageCount={pageCount}
          total={filtered.length}
          pageSize={DEFAULT_PAGE_SIZE}
          onPageChange={(next) => setPageState({ key: filterKey, page: next })}
        />
      ) : null}
    </div>
  );
}
