import type { ComponentProps } from "react";

import { controlClass } from "@/lib/ui/classes";
import { cn } from "@/lib/utils";

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(controlClass, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}
