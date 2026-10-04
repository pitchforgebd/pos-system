import type { ComponentProps } from "react";

import { controlClass } from "@/lib/ui/classes";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(controlClass, "h-auto min-h-24 py-2", className)}
      {...props}
    />
  );
}
