import { cn } from "@/lib/utils";

const tones = {
  neutral: "border-border bg-surface-muted text-text",
  success: "border-success/20 bg-success-subtle text-success",
  warning: "border-warning/20 bg-warning-subtle text-warning",
  error: "border-error/20 bg-error-subtle text-error",
  info: "border-info/20 bg-info-subtle text-info",
} as const;

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}
