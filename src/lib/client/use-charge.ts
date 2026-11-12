"use client";

import { useEffect, useRef, useState } from "react";

export type ChargeSuggestion = {
  kind: "CASH" | "BANK" | "MOBILE";
  percent: string;
  fixed: string;
  bearer: "SHOP" | "CUSTOMER";
  /** What the shop pays the bank or the mobile service (0 when the customer bears it). */
  charge: string;
  /** What the customer should send on top (0 when the shop bears it). */
  customerPays: string;
};

/**
 * The charge a bank or mobile account takes on this amount (D7): the forms propose it and the user may change it. Nothing is asked for a cash account
 * or while the amount is not a valid figure; the answer belongs to the account and amount it was asked for, so a stale one is never shown.
 */
export function useChargeSuggestion(accountId: string, amount: string, onFound?: (suggestion: ChargeSuggestion) => void): ChargeSuggestion | null {
  const text = amount.trim();
  const key = `${accountId}|${text}`;
  const [found, setFound] = useState<{ key: string; data: ChargeSuggestion } | null>(null);
  const latest = useRef(onFound);
  useEffect(() => {
    latest.current = onFound;
  });

  useEffect(() => {
    if (!accountId || !/^\d{1,14}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/v1/money-accounts/charge?accountId=${encodeURIComponent(accountId)}&amount=${encodeURIComponent(text)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((body: { success?: boolean; data?: ChargeSuggestion }) => {
          if (body.success && body.data) {
            setFound({ key, data: body.data });
            latest.current?.(body.data);
          }
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accountId, text, key]);

  return found && found.key === key ? found.data : null;
}

/** "1.85% + 10.00: suggested 28.50", or what the customer should add when the customer bears it; "" when there is nothing to say. */
export function chargeHint(suggestion: ChargeSuggestion | null) {
  if (!suggestion || suggestion.kind === "CASH" || (Number(suggestion.percent) === 0 && Number(suggestion.fixed) === 0)) {
    return "";
  }
  const rule = [Number(suggestion.percent) > 0 ? `${suggestion.percent}%` : "", Number(suggestion.fixed) > 0 ? suggestion.fixed : ""].filter(Boolean).join(" + ");
  return suggestion.bearer === "CUSTOMER" ? `${rule}: the customer bears it. Ask them to send ${suggestion.customerPays} more.` : `${rule}: suggested ${suggestion.charge}. You can change it.`;
}
