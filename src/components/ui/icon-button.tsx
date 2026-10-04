import type { ComponentProps } from "react";

import { buttonVariants } from "@/lib/ui/classes";
import { cn } from "@/lib/utils";

type IconButtonProps = Omit<ComponentProps<"button">, "aria-label"> & {
  label: string;
};

export function IconButton({ label, className, type = "button", children, ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), className)}
      {...props}
    >
      {children}
    </button>
  );
}
