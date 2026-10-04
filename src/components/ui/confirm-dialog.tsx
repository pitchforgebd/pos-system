"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "primary",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
