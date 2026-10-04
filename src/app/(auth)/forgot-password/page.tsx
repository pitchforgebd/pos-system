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
});

export default function ForgotPasswordPage() {
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
        const parsed = schema.safeParse({ email });
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
          .then(async (response) => {
            const body = (await response.json()) as { message?: string; error?: { message?: string } };
            setMessage(body.error?.message ?? body.message ?? "Request received.");
            setPending(false);
          })
          .catch(() => {
            setMessage("Request failed.");
            setPending(false);
          });
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">Forgot password</h1>
        <p className="mt-1 text-sm text-muted">Reset instructions are issued for an active account. The response does not say whether the email exists.</p>
      </div>
      {message ? <Alert tone="info" title={message} /> : null}
      <FormField label="Email" htmlFor="forgot-email" required error={error}>
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
        Send reset
      </Button>
      <p className="text-sm">
        <Link href="/login" className="text-primary">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
