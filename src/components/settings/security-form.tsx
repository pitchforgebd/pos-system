"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormSubmit } from "@/lib/client/use-form-submit";

/** How many minutes of doing nothing sign a user out (N20). */
export function IdleTimeoutForm({ minutes, min, max }: { minutes: number; min: number; max: number }) {
  const form = useFormSubmit("/api/v1/settings/security", (data) => ({ idleTimeoutMinutes: Number(data.get("idleTimeoutMinutes")) }));
  return (
    <form className="grid max-w-md gap-2" onSubmit={form.onSubmit}>
      <label className="grid gap-1 text-sm" htmlFor="idle-timeout">
        Sign a user out after this many minutes of doing nothing
        <Input id="idle-timeout" name="idleTimeoutMinutes" type="number" inputMode="numeric" min={min} max={max} step={1} defaultValue={minutes} required />
      </label>
      <p className="text-xs text-muted">
        From {min} to {max} minutes. A session also ends 12 hours after it began, whatever the user does. Someone who was signed out signs in again and loses nothing that was saved.
      </p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" size="sm" variant="secondary" loading={form.pending}>
        Save
      </Button>
    </form>
  );
}
