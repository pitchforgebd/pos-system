import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DateFilter({ from, to }: { from?: string; to?: string }) {
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      <label className="grid gap-1 text-sm">
        From
        <Input name="from" type="date" defaultValue={from} aria-label="From" />
      </label>
      <label className="grid gap-1 text-sm">
        To
        <Input name="to" type="date" defaultValue={to} aria-label="To" />
      </label>
      <Button type="submit">Apply</Button>
    </form>
  );
}

export function ReportNote({ count, shown }: { count: number; shown: number }) {
  if (count <= shown) {
    return null;
  }
  return <p className="text-sm text-muted">The total includes every matching row. This table shows the latest {shown}.</p>;
}
