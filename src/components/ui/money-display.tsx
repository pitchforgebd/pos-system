import { MOCK_CURRENCY } from "@/constants/app";
import { formatMoney } from "@/lib/format/money";
import { cn } from "@/lib/utils";

export function MoneyDisplay({
  amount,
  currency = MOCK_CURRENCY,
  className,
}: {
  amount: number;
  currency?: string;
  className?: string;
}) {
  return <span className={cn("tabular-nums", className)}>{formatMoney(amount, currency)}</span>;
}
