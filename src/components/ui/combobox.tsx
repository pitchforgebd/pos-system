"use client";

import { useId, useMemo, useState } from "react";

import { controlClass } from "@/lib/ui/classes";
import { cn } from "@/lib/utils";

export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Search",
  invalid = false,
  describedById,
}: {
  id: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  describedById?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
        className={cn(controlClass)}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? "")}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
            setOpen(true);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          }
          if (event.key === "Enter" && open && filtered[activeIndex]) {
            event.preventDefault();
            onChange(filtered[activeIndex].value);
            setOpen(false);
          }
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-[0_8px_24px_rgba(15,39,68,0.12)]"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matches</li>
          ) : (
            filtered.map((option, index) => (
              <li key={option.value} role="option" aria-selected={option.value === value}>
                <button
                  type="button"
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm hover:bg-secondary",
                    index === activeIndex && "bg-secondary",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
