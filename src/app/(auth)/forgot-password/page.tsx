"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = z.object({ email: z.string().trim().email(t("auth.invalidEmail")) }).safeParse({ email });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message);
          setMessage(null);
          return;
        }
        setError(undefined);
        setPending(true);
        void fetch("/api/v1/auth/forgot-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        })
          .then((response) => {
            setMessage(response.status === 429 ? t("auth.tooMany") : response.ok ? t("auth.received") : t("auth.requestFailed"));
            setPending(false);
          })
          .catch(() => {
            setMessage(t("auth.requestFailed"));
            setPending(false);
          });
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">{t("auth.forgotTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("auth.forgotHint")}</p>
      </div>
      {message ? <Alert tone="info" title={message} /> : null}
      <FormField label={t("auth.email")} htmlFor="forgot-email" required error={error}>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="username"
          value={email}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy("forgot-email", undefined, error)}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={pending}>
        {t("auth.send")}
      </Button>
      <p className="text-sm">
        <Link href="/login" className="text-primary">
          {t("auth.back")}
        </Link>
      </p>
    </form>
  );
}
