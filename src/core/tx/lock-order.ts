/**
 * The order in which a transaction takes its locks (01_ARCHITECTURE section 4). Everybody takes them in
 * this order, so two transactions never wait for each other in a circle:
 *   1. the document number (document_sequences)
 *   2. the parties (customer, vendor, courier), by id
 *   3. stock rows (stock_balances), sorted with stockLockOrder()
 *   4. serial numbers / IMEI
 */
export const LOCK_ORDER = ["document_sequence", "party", "stock_balance", "serial"] as const;

type StockKey = { productId: string; warehouseId?: string | null; variantId?: string | null };

function compare(a: string | null | undefined, b: string | null | undefined) {
  if (a === b) {
    return 0;
  }
  if (a == null) {
    return 1; // a missing value sorts last
  }
  if (b == null) {
    return -1;
  }
  return a < b ? -1 : 1;
}

/** A copy of `rows` sorted by product, then warehouse, then variant: the order to lock stock rows in. */
export function stockLockOrder<T extends StockKey>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => compare(a.productId, b.productId) || compare(a.warehouseId, b.warehouseId) || compare(a.variantId, b.variantId),
  );
}
