import type { ComponentProps } from "react";

import { controlClass } from "@/lib/ui/classes";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClass, className)} {...props} />;
}
