"use client";

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormSubmit } from "@/lib/client/use-form-submit";
import { PASSWORD_MIN } from "@/modules/auth/password-policy";

/** The signed-in user's own name and phone. */
export function ProfileDetailsForm({ name, phone }: { name: string; phone: string }) {
  const form = useFormSubmit("/api/v1/auth/profile", (data) => ({ name: String(data.get("name") ?? ""), phone: String(data.get("phone") ?? "") || null }));
  return (
    <form className="grid max-w-md gap-3" onSubmit={form.onSubmit}>
      <label className="grid gap-1 text-sm" htmlFor="profile-name">
        Name
        <Input id="profile-name" name="name" defaultValue={name} maxLength={191} required />
      </label>
      <label className="grid gap-1 text-sm" htmlFor="profile-phone">
        Phone
        <Input id="profile-phone" name="phone" defaultValue={phone} maxLength={32} inputMode="tel" />
      </label>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" size="sm" variant="secondary" loading={form.pending}>
        Save
      </Button>
    </form>
  );
}

/** Change the password: the old one is asked for; on success every other sign-in of this user ends. */
export function ChangePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const form = useFormSubmit(
    "/api/v1/auth/change-password",
    (data) => ({ currentPassword: String(data.get("currentPassword") ?? ""), newPassword: String(data.get("newPassword") ?? "") }),
    { successMessage: "Password changed. Your other sign-ins were ended.", onSuccess: () => formRef.current?.reset() },
  );
  return (
    <form ref={formRef} className="grid max-w-md gap-3" onSubmit={form.onSubmit}>
      <label className="grid gap-1 text-sm" htmlFor="current-password">
        Current password
        <Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required />
        {form.fields.currentPassword ? <span className="text-xs text-error">{form.fields.currentPassword}</span> : null}
      </label>
      <label className="grid gap-1 text-sm" htmlFor="new-password">
        New password
        <Input id="new-password" name="newPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required />
        {form.fields.newPassword ? <span className="text-xs text-error">{form.fields.newPassword}</span> : null}
      </label>
      <p className="text-xs text-muted">At least {PASSWORD_MIN} characters, not a common password, not made from your name or email. Changing it ends your other sign-ins on other devices.</p>
      {form.message && Object.keys(form.fields).length === 0 ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" size="sm" loading={form.pending}>
        Change password
      </Button>
    </form>
  );
}
