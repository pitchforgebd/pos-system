import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPhrase } from "@/lib/i18n/server";

export async function DateFilter({ from, to }: { from?: string; to?: string }) {
  const ph = await getPhrase();
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      <label className="grid gap-1 text-sm">
        {ph("From")}
        <Input name="from" type="date" defaultValue={from} aria-label={ph("From")} />
      </label>
      <label className="grid gap-1 text-sm">
        {ph("To")}
        <Input name="to" type="date" defaultValue={to} aria-label={ph("To")} />
      </label>
      <Button type="submit">{ph("Apply")}</Button>
    </form>
  );
}

export async function ReportNote({ count, shown }: { count: number; shown: number }) {
  const ph = await getPhrase();
  if (count <= shown) {
    return null;
  }
  return <p className="text-sm text-muted">{ph("The total includes every matching row. This table shows the latest")} {shown}.</p>;
}
