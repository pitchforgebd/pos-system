"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { formatDisplayDate } from "@/lib/format/date";

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Select a date",
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  const today = new Date();
  const [year, setYear] = useState(value ? Number(value.slice(0, 4)) : today.getFullYear());
  const [month, setMonth] = useState(value ? Number(value.slice(5, 7)) : today.getMonth() + 1);
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button id={id} variant="secondary" className="w-full justify-start font-normal">
          <CalendarDays className="size-4 text-muted" aria-hidden="true" />
          {value ? formatDisplayDate(value) : placeholder}
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
            selected={value}
            onMonthChange={(nextYear, nextMonth) => {
              setYear(nextYear);
              setMonth(nextMonth);
            }}
            onSelect={(isoDate) => {
              onChange(isoDate);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
