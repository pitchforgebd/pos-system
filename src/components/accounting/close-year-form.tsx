"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormSubmit } from "@/lib/client/use-form-submit";

/** Closing a finished year: the owner types the year's name to confirm. It cannot be undone: the period is locked. */
export function CloseYearForm({ startYear, label }: { startYear: number; label: string }) {
  const form = useFormSubmit("/api/v1/accounting/year-end", (data) => ({ startYear, confirm: data.get("confirm") }));
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={form.onSubmit}>
      <label className="grid gap-1 text-xs">
        {`Type ${label} to close it`}
        <Input name="confirm" required maxLength={16} placeholder={label} autoComplete="off" />
      </label>
      <Button type="submit" variant="danger" size="sm" loading={form.pending}>
        Close the year
      </Button>
      {form.message ? <p className="w-full text-sm text-error">{form.message}</p> : null}
    </form>
  );
}
