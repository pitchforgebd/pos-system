"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

export function Menu({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          sideOffset={6}
          align="end"
          className="z-50 min-w-56 rounded-md border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(15,39,68,0.12)]"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  disabled = false,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className="cursor-pointer rounded-md px-3 py-2 text-sm text-text outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-muted data-[highlighted]:bg-secondary"
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted">{children}</p>;
}
