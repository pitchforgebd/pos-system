"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

export function NamedRecordForm({ action, label }: { action: string; label: string }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();

  return (
    <form
      className="flex max-w-md flex-col gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({ url: action, body: { name: form.get("name") } });
      }}
    >
      <Input name="name" required placeholder={label} aria-label={label} />
      <Button type="submit" loading={pending}>
        {ph("Add")}
      </Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}
