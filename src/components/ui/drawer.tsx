"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  side = "right",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  side?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#152033]/40" />
        <Dialog.Content
          className={cn(
            "fixed top-0 z-50 flex h-full w-[min(100%,24rem)] flex-col border-border bg-surface focus:outline-none",
            side === "left" ? "left-0 border-r" : "right-0 border-l",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-text">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close panel">
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
