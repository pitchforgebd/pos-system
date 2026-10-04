"use client";

import { MOCK_CURRENCY } from "@/constants/app";

import { Input } from "@/components/ui/input";

function sanitizeMoney(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...fraction] = cleaned.split(".");
  if (fraction.length === 0) {
    return whole;
  }
  return `${whole}.${fraction.join("").slice(0, 2)}`;
}

export function CurrencyInput({
  id,
  value,
  onChange,
  invalid = false,
  describedById,
  currency = MOCK_CURRENCY,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedById?: string;
  currency?: string;
}) {
  return (
    <div className="flex">
      <span className="inline-flex h-10 items-center rounded-l-md border border-r-0 border-border bg-surface-muted px-3 text-xs font-medium text-muted">
        {currency}
      </span>
      <Input
        id={id}
        inputMode="decimal"
        className="rounded-l-none"
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
        onChange={(event) => onChange(sanitizeMoney(event.target.value))}
      />
    </div>
  );
}
