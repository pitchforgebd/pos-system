"use client";

import { useEffect, useState } from "react";

type Tone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: Tone };

const EVENT = "meridian:toast";
const SHOW_MS = 4500;

const tones: Record<Tone, string> = {
  success: "border-success/30 bg-success-subtle",
  error: "border-error/30 bg-error-subtle",
  info: "border-info/30 bg-info-subtle",
};

/** Shows a short message in the corner. Safe to call from anywhere in the browser; does nothing on the server. */
export function showToast(message: string, tone: Tone = "success") {
  if (typeof window === "undefined" || !message) {
    return;
  }
  window.dispatchEvent(new CustomEvent<{ message: string; tone: Tone }>(EVENT, { detail: { message, tone } }));
}

/** Mounted once in the root layout. */
export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let next = 1;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (event: Event) => {
      const { message, tone } = (event as CustomEvent<{ message: string; tone: Tone }>).detail;
      const id = next++;
      setToasts((current) => [...current.slice(-3), { id, message, tone }]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, SHOW_MS);
      timers.add(timer);
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] grid max-w-sm gap-2 px-4 sm:px-0">
      {toasts.map((toast) => (
        <div key={toast.id} role="status" className={`pointer-events-auto rounded-md border px-3 py-2 text-sm text-text shadow-md ${tones[toast.tone]}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
