import type { ReactNode } from "react";

export function ChartCard({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
