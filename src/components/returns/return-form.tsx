"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

type Line = { documentId: string; itemId: string; label: string };

export function ReturnForm({ lines, kind }: { lines: Line[]; kind: "sale" | "purchase" }) {
  const { t } = useI18n();
  const [localMessage, setLocalMessage] = useState("");
  const { submit, pending, message: serverMessage } = useSubmit();
  const message = localMessage || serverMessage;
  const [query, setQuery] = useState("");
  const visible = lines.filter((line) => line.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const [documentId, itemId] = String(form.get("line") || "").split("|");
        const method = String(form.get("refundMethod") || "");
        if (!documentId || !itemId) {
          setLocalMessage(t("returns.chooseLine"));
          return;
        }
        setLocalMessage("");
        const path = kind === "sale" ? `/api/v1/sales/${documentId}/return` : `/api/v1/purchases/${documentId}/return`;
        const line = kind === "sale" ? { saleItemId: itemId, quantity: form.get("quantity") } : { purchaseItemId: itemId, quantity: form.get("quantity") };
        void submit(
          {
            url: path,
            body: {
              businessDate: form.get("businessDate"),
              refundMethod: method ? method : undefined,
              lines: [line],
            },
          },
          { successMessage: t("returns.saved") },
        );
      }}
    >
      <label className="grid gap-1 text-sm">
        {t("returns.search")}
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("returns.searchPlaceholder")} aria-label={t("returns.searchLabel")} className="h-10 rounded-md border border-border px-3" />
      </label>
      <label className="grid gap-1 text-sm">
        {t("returns.product")}
        <select name="line" required className="h-10 rounded-md border border-border bg-surface px-2">
          {visible.map((line) => (
            <option key={line.itemId} value={`${line.documentId}|${line.itemId}`}>
              {line.label}
            </option>
          ))}
        </select>
      </label>
      <Input name="businessDate" type="date" required aria-label={t("returns.date")} />
      <Input name="quantity" required placeholder={t("returns.quantity")} aria-label={t("returns.quantity")} />
      {kind === "purchase" ? (
        <label className="grid gap-1 text-sm">
          {t("returns.refundMethod")}
          <select name="refundMethod" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="">
            <option value="">{t("returns.noCashRefund")}</option>
            <option value="CASH">{t("returns.cash")}</option>
            <option value="BANK">{t("returns.bank")}</option>
          </select>
        </label>
      ) : (
        <label className="grid gap-1 text-sm">
          {t("returns.refund")}
          <select name="refundMethod" className="h-10 rounded-md border border-border bg-surface px-2" defaultValue="">
            <option value="">{t("returns.wayPaid")}</option>
            <option value="CASH">{t("returns.cash")}</option>
            <option value="BANK">{t("returns.bank")}</option>
            <option value="ADVANCE">{t("returns.toAdvance")}</option>
            <option value="AR_ONLY">{t("returns.asCredit")}</option>
          </select>
        </label>
      )}
      <p className="text-sm text-muted">{t("returns.limit")}</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending} disabled={visible.length === 0}>
        {t("returns.post")}
      </Button>
    </form>
  );
}
