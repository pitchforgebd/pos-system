import { Search } from "lucide-react";
import type { ComponentProps } from "react";

import { controlClass } from "@/lib/ui/classes";
import { cn } from "@/lib/utils";

export function SearchInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input className={cn(controlClass, "pl-9", className)} type="search" {...props} />
    </div>
  );
}
