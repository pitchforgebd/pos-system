"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { EmptyState } from "@/components/ui/states";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Pagination } from "@/components/ui/pagination";
import { PrintPreview } from "@/components/ui/print-preview";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { DEFAULT_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "@/constants/ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDisplayDate } from "@/lib/format/date";
import { sampleBranches, sampleSales, type SampleSale, type SampleSaleStatus } from "@/lib/mock/dashboard";

const statusTone: Record<SampleSaleStatus, "success" | "warning" | "error"> = {
  Paid: "success",
  Partial: "warning",
  Due: "error",
};

type SortKey = "invoice" | "date" | "customer" | "total";

export function RecentSales() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | SampleSaleStatus>("all");
  const [branch, setBranch] = useState<"all" | (typeof sampleBranches)[number]>("all");
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [preview, setPreview] = useState<SampleSale | null>(null);
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const filterKey = `${debouncedQuery}|${status}|${branch}|${range.from ?? ""}|${range.to ?? ""}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  if (pageState.key !== filterKey) {
    setPageState({ key: filterKey, page: 1 });
  }
  const page = pageState.page;
  const setPage = (next: number) => setPageState({ key: filterKey, page: next });

  const filtered = useMemo(() => {
    const needle = debouncedQuery.trim().toLowerCase();
    const rows = sampleSales.filter((sale) => {
      const matchesQuery =
        needle.length === 0 ||
        sale.invoice.toLowerCase().includes(needle) ||
        sale.customer.toLowerCase().includes(needle);
      const matchesStatus = status === "all" || sale.status === status;
      const matchesBranch = branch === "all" || sale.branch === branch;
      const matchesFrom = !range.from || sale.date >= range.from;
      const matchesTo = !range.to || sale.date <= range.to;
      return matchesQuery && matchesStatus && matchesBranch && matchesFrom && matchesTo;
    });

    return [...rows].sort((left, right) => {
      const result =
        sortKey === "total" ? left.total - right.total : left[sortKey].localeCompare(right[sortKey]);
      return sortDirection === "asc" ? result : -result;
    });
  }, [branch, debouncedQuery, range.from, range.to, sortDirection, sortKey, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * DEFAULT_PAGE_SIZE, currentPage * DEFAULT_PAGE_SIZE);

  const columns: Column<SampleSale>[] = [
    { key: "invoice", header: "Invoice", sortable: true, cell: (row) => row.invoice },
    { key: "date", header: "Date", sortable: true, cell: (row) => formatDisplayDate(row.date) },
    { key: "customer", header: "Customer", sortable: true, cell: (row) => row.customer },
    { key: "branch", header: "Branch", cell: (row) => row.branch },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge tone={statusTone[row.status]}>{row.status}</StatusBadge>,
    },
    {
      key: "total",
      header: "Total",
      sortable: true,
      cell: (row) => <MoneyDisplay amount={row.total} />,
    },
    {
      key: "print",
      header: "Preview",
      cell: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setPreview(row)}>
          Print
        </Button>
      ),
    },
  ];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-text">Recent sales</h2>
        <p className="text-xs text-muted">Sample invoices for the table, filters, and print layout.</p>
      </div>
      <FilterBar>
        <div className="min-w-48 flex-1">
          <FormField label="Search" htmlFor="sales-search">
            <SearchInput
              id="sales-search"
              value={query}
              placeholder="Invoice or customer"
              onChange={(event) => setQuery(event.target.value)}
            />
          </FormField>
        </div>
        <div className="min-w-36">
          <FormField label="Status" htmlFor="sales-status">
            <Select
              id="sales-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as "all" | SampleSaleStatus)}
            >
              <option value="all">All</option>
              <option value="Paid">Paid</option>
              <option value="Partial">Partial</option>
              <option value="Due">Due</option>
            </Select>
          </FormField>
        </div>
        <div className="min-w-40">
          <FormField label="Branch" htmlFor="sales-branch">
            <Select
              id="sales-branch"
              value={branch}
              onChange={(event) => setBranch(event.target.value as "all" | (typeof sampleBranches)[number])}
            >
              <option value="all">All branches</option>
              {sampleBranches.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="min-w-64">
          <FormField label="Date" htmlFor="sales-dates">
            <DateRangePicker id="sales-dates" value={range} onChange={setRange} />
          </FormField>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setQuery("");
            setStatus("all");
            setBranch("all");
            setRange({ from: null, to: null });
          }}
        >
          Reset
        </Button>
      </FilterBar>
      <DataTable
        caption="Recent sample sales"
        columns={columns}
        rows={visible}
        getRowKey={(row) => row.id}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={(key) => {
          const nextKey = key as SortKey;
          if (sortKey === nextKey) {
            setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
            return;
          }
          setSortKey(nextKey);
          setSortDirection("asc");
        }}
        empty={
          <EmptyState
            title="No sample sales"
            description="Nothing in the sample list matches these filters."
          />
        }
      />
      <Pagination
        page={currentPage}
        pageCount={pageCount}
        total={filtered.length}
        pageSize={DEFAULT_PAGE_SIZE}
        onPageChange={setPage}
      />
      <Modal
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
          }
        }}
        title="Print preview"
        description="Layout preview only. This does not create an invoice."
      >
        {preview ? (
          <div className="space-y-4">
            <PrintPreview
              invoice={preview.invoice}
              date={preview.date}
              customer={preview.customer}
              total={preview.total}
            />
            <div className="flex justify-end print:hidden">
              <Button onClick={() => window.print()}>Print</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
