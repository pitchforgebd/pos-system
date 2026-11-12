"use client";

import { Input } from "@/components/ui/input";
import { chargeHint, useChargeSuggestion } from "@/lib/client/use-charge";

/**
 * The charge field of a form that takes or pays money through a bank or mobile account (D7). When the account and the amount are known the field is
 * filled from the account's rule; the user may change it, and what they typed is not replaced. A cash account shows nothing.
 *
 * `onChange(value, typed)`: `typed` is true when the user wrote it and false when it is the proposal.
 */
export function ChargeInput({
  accountId,
  amount,
  value,
  typed,
  onChange,
  label = "Bank or mobile charge",
  className,
  bare = false,
}: {
  accountId: string;
  amount: string;
  value: string;
  typed: boolean;
  onChange: (value: string, typed: boolean) => void;
  label?: string;
  className?: string;
  /** Only the input (the register's row has no label of its own). */
  bare?: boolean;
}) {
  const suggestion = useChargeSuggestion(accountId, amount, (found) => {
    if (!typed) {
      onChange(Number(found.charge) > 0 ? found.charge : "", false);
    }
  });
  const hint = chargeHint(suggestion);
  const input = <Input className={className} inputMode="decimal" aria-label="Charge" placeholder="0.00" value={value} onChange={(event) => onChange(event.target.value, true)} />;
  if (bare) {
    return input;
  }
  return (
    <label className="grid gap-1 text-sm">
      {label}
      {input}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}
