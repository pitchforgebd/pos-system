import type { ReactNode } from "react";

import { Breadcrumb } from "@/components/ui/breadcrumb";

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumbs: { label: string; href?: string }[];
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <Breadcrumb items={breadcrumbs} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
