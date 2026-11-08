// The one way a list is paged and sorted (B11, LV-3). A list used to be "the newest 100" with no way to reach the
// rest. Now every list reads ?page=&pageSize=&sort= the same way, clamps what it gets, sorts only by a name the list
// allows (so a request cannot ask for an order that scans the table), and answers with the page and the total.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

type OrderBy = Record<string, unknown>;

export type ListSorts = Record<string, OrderBy[]>;

export type ListQueryOptions = {
  defaultPageSize?: number;
  maxPageSize?: number;
  /** The sorts a request may ask for: a name -> the Prisma orderBy that sorts ascending. "-name" asks for descending. */
  sorts?: ListSorts;
  /** Used when the request names no sort or an unknown one. Default "-date". */
  defaultSort?: string;
};

export type ListQuery = {
  page: number;
  pageSize: number;
  /** The sort in use, "name" or "-name". */
  sort: string;
  skip: number;
  take: number;
  /** Ready for Prisma's `orderBy`. */
  orderBy: OrderBy[];
};

export type PageInfo = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  sort: string;
  /** 1-based position of the first and last row on this page (0 and 0 for an empty list). */
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

export type Paged<T> = { rows: T[]; page: PageInfo };

type Raw = string | number | string[] | null | undefined;

function first(value: Raw | unknown): string {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === "string" || typeof one === "number" ? String(one).trim() : "";
}

function wholeNumber(value: unknown, fallback: number, min: number, max: number) {
  const text = first(value);
  if (!/^\d{1,9}$/.test(text)) {
    return fallback;
  }
  return Math.min(Math.max(Number(text), min), max);
}

/** Flips every asc to desc and back, so one ascending definition serves both directions. */
export function reverseOrder(orderBy: OrderBy[]): OrderBy[] {
  const flip = (value: unknown): unknown => {
    if (value === "asc") return "desc";
    if (value === "desc") return "asc";
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, flip(inner)]));
    }
    return value;
  };
  return orderBy.map((item) => flip(item) as OrderBy);
}

/**
 * The order of a document list: business date, then document number, then id so the order is total and a page
 * never repeats or skips a row. `number` says where the number lives ({ number: "asc" } on a purchase,
 * { invoice: { number: "asc" } } on a sale). Newest first is "-date" (the default).
 */
export function documentSorts(number: OrderBy): ListSorts {
  return {
    date: [{ businessDate: "asc" }, number, { id: "asc" }],
    number: [number, { businessDate: "asc" }, { id: "asc" }],
  };
}

/**
 * Reads the paging and sorting a request asked for and turns it into what a query needs. Anything odd (a page of
 * "abc", a page size of 100000, an unknown sort) falls back to a safe value instead of failing.
 *
 *   const query = listQuery({ page: params.page, pageSize: params.pageSize, sort: params.sort }, { sorts: documentSorts({ number: "asc" }) });
 *   const rows = await prisma.purchase.findMany({ where, orderBy: query.orderBy, skip: query.skip, take: query.take });
 */
export function listQuery(input: { page?: unknown; pageSize?: unknown; sort?: unknown }, options: ListQueryOptions = {}): ListQuery {
  const maxPageSize = options.maxPageSize ?? MAX_PAGE_SIZE;
  const pageSize = wholeNumber(input.pageSize, Math.min(options.defaultPageSize ?? DEFAULT_PAGE_SIZE, maxPageSize), 1, maxPageSize);
  const page = wholeNumber(input.page, 1, 1, 1_000_000);
  const sorts = options.sorts ?? documentSorts({ id: "asc" });
  const defaultSort = options.defaultSort ?? "-date";

  const resolve = (name: string): { sort: string; orderBy: OrderBy[] } | null => {
    const descending = name.startsWith("-");
    const base = descending ? name.slice(1) : name;
    const ascending = Object.hasOwn(sorts, base) ? sorts[base] : undefined;
    return ascending ? { sort: name, orderBy: descending ? reverseOrder(ascending) : ascending } : null;
  };
  const chosen = resolve(first(input.sort)) ?? resolve(defaultSort);
  if (!chosen) {
    throw new Error(`The default sort "${defaultSort}" is not one of the sorts this list allows.`);
  }
  return { page, pageSize, sort: chosen.sort, skip: (page - 1) * pageSize, take: pageSize, orderBy: chosen.orderBy };
}

/** The numbers a pager needs, from the total the database counted. */
export function pageInfo(total: number, query: Pick<ListQuery, "page" | "pageSize" | "sort">, rowsOnPage = Math.min(query.pageSize, Math.max(total - (query.page - 1) * query.pageSize, 0))): PageInfo {
  const pageCount = Math.max(Math.ceil(total / query.pageSize), 1);
  const from = rowsOnPage > 0 ? (query.page - 1) * query.pageSize + 1 : 0;
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    pageCount,
    sort: query.sort,
    from,
    to: rowsOnPage > 0 ? from + rowsOnPage - 1 : 0,
    hasPrevious: query.page > 1,
    hasNext: query.page < pageCount,
  };
}

/** The same list again with another page, keeping the other query parameters (for the links of a pager). */
export function pageHref(path: string, params: Record<string, Raw | unknown>, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const text = first(value);
    if (key !== "page" && text) {
      search.set(key, text);
    }
  }
  if (page > 1) {
    search.set("page", String(page));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}
