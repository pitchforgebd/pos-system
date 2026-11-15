"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { useI18n } from "@/lib/i18n/provider";
import { monthName, weekdayName, withDigits } from "@/lib/format/locale";
import {
  daysInMonth,
  shiftMonth,
  toIsoDate,
  weekdayIndex,
} from "@/lib/format/date";
import { cn } from "@/lib/utils";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function Calendar({
  year,
  month,
  onMonthChange,
  selected,
  rangeStart,
  rangeEnd,
  onSelect,
}: {
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  selected?: string | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  onSelect: (isoDate: string) => void;
}) {
  const { t, lang, digits } = useI18n();
  const count = daysInMonth(year, month);
  const leading = weekdayIndex(year, month, 1);
  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: count }, (_, index) => index + 1),
  ];

  return (
    <div className="w-72">
      <div className="mb-2 flex items-center justify-between">
        <IconButton
          label={t("common.prevMonth")}
          onClick={() => {
            const next = shiftMonth(year, month, -1);
            onMonthChange(next.year, next.month);
          }}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <p className="text-sm font-medium">{withDigits(`${monthName(month, lang)} ${year}`, digits)}</p>
        <IconButton
          label={t("common.nextMonth")}
          onClick={() => {
            const next = shiftMonth(year, month, 1);
            onMonthChange(next.year, next.month);
          }}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-1">
            {weekdayName(day, lang).slice(0, lang === "bn" ? 3 : 2)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) {
            return <span key={`empty-${index}`} />;
          }
          const iso = toIsoDate(year, month, day);
          const inRange =
            rangeStart && rangeEnd ? iso >= rangeStart && iso <= rangeEnd : false;
          const isSelected = selected === iso || rangeStart === iso || rangeEnd === iso;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              className={cn(
                "h-9 rounded-md text-sm hover:bg-secondary",
                inRange && "bg-secondary",
                isSelected && "bg-primary text-primary-foreground hover:bg-primary-hover",
              )}
            >
              {withDigits(String(day), digits)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
