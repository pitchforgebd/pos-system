"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { formatDisplayDate } from "@/lib/format/date";

export type DateRange = {
  from: string | null;
  to: string | null;
};

export function DateRangePicker({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [open, setOpen] = useState(false);

  const label =
    value.from && value.to
      ? `${formatDisplayDate(value.from)} – ${formatDisplayDate(value.to)}`
      : value.from
        ? `${formatDisplayDate(value.from)} – …`
        : "All dates";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button id={id} variant="secondary" className="w-full justify-start font-normal">
          <CalendarDays className="size-4 text-muted" aria-hidden="true" />
          {label}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-md border border-border bg-surface p-3 shadow-[0_8px_24px_rgba(15,39,68,0.12)]"
        >
          <Calendar
            year={year}
            month={month}
            rangeStart={value.from}
            rangeEnd={value.to}
            onMonthChange={(nextYear, nextMonth) => {
              setYear(nextYear);
              setMonth(nextMonth);
            }}
            onSelect={(isoDate) => {
              if (!value.from || value.to) {
                onChange({ from: isoDate, to: null });
                return;
              }
              if (isoDate < value.from) {
                onChange({ from: isoDate, to: value.from });
              } else {
                onChange({ from: value.from, to: isoDate });
              }
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
