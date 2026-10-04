import { cva } from "class-variance-authority";

export const controlClass =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted aria-invalid:border-error";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "border-primary bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "border-border bg-surface text-text hover:bg-secondary",
        ghost: "border-transparent bg-transparent text-text hover:bg-secondary",
        danger: "border-error bg-error text-white hover:bg-error/90",
      },
      size: {
        sm: "h-8 px-2.5",
        md: "h-10 px-3",
        lg: "h-11 px-4",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);
