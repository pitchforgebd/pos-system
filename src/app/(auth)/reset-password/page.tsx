"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string().min(8, "Use at least 8 characters."),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "Enter the same password again.",
  });

export default function ResetPasswordPage() {
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
        const parsed = schema.safeParse({ password, confirm });
        if (!parsed.success) {
          const next: { password?: string; confirm?: string } = {};
          for (const issue of parsed.error.issues) {
            const key = issue.path[0];
            if ((key === "password" || key === "confirm") && !next[key]) {
              next[key] = issue.message;
            }
          }
          setErrors(next);
          return;
        }
        const token = new URLSearchParams(window.location.search).get("token") ?? "";
        setPending(true);
        void fetch("/api/v1/auth/reset-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, password: parsed.data.password }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { message?: string; error?: { message?: string } };
            setMessage(body.error?.message ?? body.message ?? "Password was changed.");
            setDone(response.ok);
            setPending(false);
          })
          .catch(() => {
            setMessage("Reset failed.");
            setPending(false);
          });
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">Reset password</h1>
        <p className="mt-1 text-sm text-muted">Choose a new password. This link works once.</p>
      </div>
      {message ? <Alert tone={done ? "success" : "error"} title={message} /> : null}
      <FormField label="New password" htmlFor="reset-password" required error={errors.password}>
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
      <FormField label="Confirm password" htmlFor="reset-confirm" required error={errors.confirm}>
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
        Change password
      </Button>
      <p className="text-sm">
        <Link href="/login" className="text-primary">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
