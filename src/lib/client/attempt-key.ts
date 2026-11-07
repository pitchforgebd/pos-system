"use client";

import { useRef } from "react";

/**
 * One idempotency key per attempt: a retry after a failure or a lost response reuses it, so the
 * server replays the first result instead of posting twice. Call `renew()` after a successful save.
 */
export function useAttemptKey() {
  const ref = useRef<string | null>(null);
  return {
    current: () => (ref.current ??= crypto.randomUUID()),
    renew: () => {
      ref.current = null;
    },
  };
}
