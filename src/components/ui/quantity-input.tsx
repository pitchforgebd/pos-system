"use client";

import { Minus, Plus } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";

export function QuantityInput({
  id,
  value,
  onChange,
  invalid = false,
  describedById,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  invalid?: boolean;
  describedById?: string;
}) {
  return (
    <div className="flex">
      <IconButton
        label="Decrease quantity"
        className="rounded-r-none border border-border"
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        <Minus className="size-4" aria-hidden="true" />
      </IconButton>
      <Input
        id={id}
        inputMode="numeric"
        className="rounded-none text-center"
        value={String(value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          onChange(Number.isNaN(next) ? 0 : Math.max(0, next));
        }}
      />
      <IconButton
        label="Increase quantity"
        className="rounded-l-none border border-border"
        onClick={() => onChange(value + 1)}
      >
        <Plus className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  );
}
