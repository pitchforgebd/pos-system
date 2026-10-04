import { APP_NAME } from "@/constants/app";
import { MoneyDisplay } from "@/components/ui/money-display";
import { formatDisplayDate } from "@/lib/format/date";

export function PrintPreview({
  invoice,
  date,
  customer,
  total,
}: {
  invoice: string;
  date: string;
  customer: string;
  total: number;
}) {
  return (
    <article className="print-sheet rounded-md border border-border bg-surface p-4">
      <header className="border-b border-border pb-3">
        <p className="text-sm font-semibold">{APP_NAME}</p>
        <p className="text-xs text-muted">Sample invoice layout</p>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-muted">Invoice</dt>
          <dd className="font-medium">{invoice}</dd>
        </div>
        <div>
          <dt className="text-muted">Date</dt>
          <dd>{formatDisplayDate(date)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">Customer</dt>
          <dd>{customer}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-muted">Line items are not available until sales are stored.</p>
      <p className="mt-4 text-right text-sm font-semibold">
        Total <MoneyDisplay amount={total} />
      </p>
    </article>
  );
}
