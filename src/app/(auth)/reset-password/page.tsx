"use client";

import Link from "next/link";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblemCode } from "@/modules/auth/password-policy";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const next: { password?: string; confirm?: string } = {};
        const problem = passwordProblemCode(password);
        if (problem) {
          next.password = t(`auth.pw.${problem}` as const, { min: PASSWORD_MIN, max: PASSWORD_MAX });
        }
        if (confirm.length === 0) {
          next.confirm = t("auth.again");
        } else if (password !== confirm) {
          next.confirm = t("auth.same");
        }
        if (next.password || next.confirm) {
          setErrors(next);
          return;
        }
        setErrors({});
        // the link carries the token after the #; an older link carried it in the address (?token=) and is still read
        const fromHash = new URLSearchParams(window.location.hash.replace("#", "")).get("token");
        const token = fromHash ?? new URLSearchParams(window.location.search).get("token") ?? "";
        setPending(true);
        void fetch("/api/v1/auth/reset-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, password }),
        })
          .then(async (response) => {
            const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
            // a password the server refuses comes back with its own sentence (English); the link problem and the limit have Bangla ones
            setMessage(response.ok ? t("auth.changed") : response.status === 429 ? t("auth.tooMany") : /invalid or expired/i.test(body?.error?.message ?? "") ? t("auth.invalidLink") : (body?.error?.message ?? t("auth.resetFailed")));
            setDone(response.ok);
            setPending(false);
          })
          .catch(() => {
            setMessage(t("auth.resetFailed"));
            setPending(false);
          });
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">{t("auth.resetTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("auth.resetHint")}</p>
      </div>
      {message ? <Alert tone={done ? "success" : "error"} title={message} /> : null}
      <FormField label={t("auth.newPassword")} htmlFor="reset-password" required error={errors.password}>
        <Input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          value={password}
          aria-invalid={Boolean(errors.password) || undefined}
          aria-describedby={describedBy("reset-password", undefined, errors.password)}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FormField>
      <FormField label={t("auth.confirm")} htmlFor="reset-confirm" required error={errors.confirm}>
        <Input
          id="reset-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          aria-invalid={Boolean(errors.confirm) || undefined}
          aria-describedby={describedBy("reset-confirm", undefined, errors.confirm)}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={pending || done}>
        {t("auth.change")}
      </Button>
      <p className="text-sm">
        <Link href="/login" className="text-primary">
          {t("auth.back")}
        </Link>
      </p>
    </form>
  );
}
