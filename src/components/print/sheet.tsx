"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/constants/app";

export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}

export function PrintSheet({ title, note, thermal = false, children }: { title: string; note?: string; thermal?: boolean; children: ReactNode }) {
  return (
    <article className={thermal ? "print-sheet thermal max-w-xs rounded-md border border-border bg-surface p-4 text-sm" : "print-sheet rounded-md border border-border bg-surface p-4"}>
      <header className="border-b border-border pb-3">
        <p className="text-sm font-semibold">{APP_NAME}</p>
        <h2 className="text-base font-semibold">{title}</h2>
        {note ? <p className="text-xs text-muted">{note}</p> : null}
      </header>
      <div className="mt-3 space-y-2 text-sm">{children}</div>
    </article>
  );
}
