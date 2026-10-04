"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters."),
});

function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/dashboard";
}

export default function LoginPage() {
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
            const body = (await response.json()) as { error?: { message?: string } };
            if (!response.ok) {
              setFormError(body.error?.message ?? "Sign in failed.");
              setPending(false);
              return;
            }
            window.location.assign(nextPath());
          })
          .catch(() => {
            setFormError("Sign in failed.");
            setPending(false);
          });
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Use the email and password for your organization.</p>
      </div>
      {formError ? <Alert tone="error" title={formError} /> : null}
      <FormField label="Email" htmlFor="login-email" required error={errors.email}>
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
      <FormField label="Password" htmlFor="login-password" required error={errors.password}>
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
        Sign in
      </Button>
      <p className="text-sm">
        <Link href="/forgot-password" className="text-primary">
          Forgot password
        </Link>
      </p>
    </form>
  );
}
