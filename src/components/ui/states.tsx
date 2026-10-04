import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface px-6 py-12 text-center">
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-md border border-error/30 bg-error-subtle px-6 py-12 text-center">
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
      {onRetry ? (
        <div className="mt-4">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PermissionDenied({
  title = "Permission required",
  description = "Your account cannot open this screen.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-6 py-12 text-center">
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
    </div>
  );
}
