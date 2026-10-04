"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export function Tabs({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      {children}
    </TabsPrimitive.Root>
  );
}

export function TabList({ children }: { children: ReactNode }) {
  return (
    <TabsPrimitive.List className="inline-flex rounded-md border border-border bg-surface-muted p-0.5">
      {children}
    </TabsPrimitive.List>
  );
}

export function TabTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="h-8 rounded-md px-3 text-sm text-muted data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-[inset_0_0_0_1px_var(--border)]"
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className="mt-4 outline-none">
      {children}
    </TabsPrimitive.Content>
  );
}
