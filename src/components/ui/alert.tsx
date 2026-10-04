import type { ReactNode } from "react";

const tones = {
  info: "border-info/30 bg-info-subtle",
  success: "border-success/30 bg-success-subtle",
  warning: "border-warning/30 bg-warning-subtle",
  error: "border-error/30 bg-error-subtle",
} as const;

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof tones;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 ${tones[tone]}`}>
      <p className="text-sm font-medium text-text">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </div>
  );
}
