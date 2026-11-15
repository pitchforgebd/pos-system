"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";

function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/dashboard";
}

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const schema = z.object({
          email: z.string().trim().email(t("auth.invalidEmail")),
          password: z.string().min(8, t("auth.passwordMin", { min: 8 })),
        });
        const parsed = schema.safeParse({ email, password });
        if (!parsed.success) {
          const next: { email?: string; password?: string } = {};
          for (const issue of parsed.error.issues) {
            const key = issue.path[0];
            if ((key === "email" || key === "password") && !next[key]) {
              next[key] = issue.message;
            }
          }
          setErrors(next);
          setFormError(null);
          return;
        }
        setErrors({});
        setPending(true);
        void fetch("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        })
          .then(async (response) => {
            if (!response.ok) {
              // the server's answer is English; the screen says it in the person's language
              setFormError(response.status === 429 ? t("auth.tooMany") : response.status === 401 ? t("auth.wrong") : t("auth.signInFailed"));
              setPending(false);
              return;
            }
            window.location.assign(nextPath());
          })
          .catch(() => {
            setFormError(t("auth.signInFailed"));
            setPending(false);
          });
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">{t("auth.signIn")}</h1>
        <p className="mt-1 text-sm text-muted">{t("auth.signInHint")}</p>
      </div>
      {formError ? <Alert tone="error" title={formError} /> : null}
      <FormField label={t("auth.email")} htmlFor="login-email" required error={errors.email}>
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          value={email}
          aria-invalid={Boolean(errors.email) || undefined}
          aria-describedby={describedBy("login-email", undefined, errors.email)}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      <FormField label={t("auth.password")} htmlFor="login-password" required error={errors.password}>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          aria-invalid={Boolean(errors.password) || undefined}
          aria-describedby={describedBy("login-password", undefined, errors.password)}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={pending}>
        {t("auth.signInButton")}
      </Button>
      <p className="text-sm">
        <Link href="/forgot-password" className="text-primary">
          {t("auth.forgot")}
        </Link>
      </p>
    </form>
  );
}
