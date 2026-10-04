import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { buttonVariants } from "@/lib/ui/classes";
import { cn } from "@/lib/utils";

type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
  href?: string;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentProps<"button">, "className" | "children">;

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  href,
  className,
  children,
  type = "button",
  disabled,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
