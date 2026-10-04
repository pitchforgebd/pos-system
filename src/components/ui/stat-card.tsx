import { MoneyDisplay } from "@/components/ui/money-display";

export function StatCard({
  label,
  amount,
  hint,
  money = true,
}: {
  label: string;
  amount: number;
  hint: string;
  money?: boolean;
}) {
  return (
    <article className="rounded-md border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-text">
        {money ? <MoneyDisplay amount={amount} /> : <span className="tabular-nums">{amount}</span>}
      </p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </article>
  );
}
