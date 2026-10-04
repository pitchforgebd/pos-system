import type { ReactNode } from "react";
import Link from "next/link";

import { APP_NAME } from "@/constants/app";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            M
          </span>
          <span className="text-sm font-semibold">{APP_NAME}</span>
        </Link>
        <div className="rounded-md border border-border bg-surface p-5">{children}</div>
      </div>
    </div>
  );
}
