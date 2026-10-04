import type { ReactNode } from "react";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 lg:flex-row lg:flex-wrap lg:items-end">
      {children}
    </div>
  );
}
