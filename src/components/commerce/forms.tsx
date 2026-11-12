"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

export function RequisitionForm() {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({ url: "/api/v1/requisitions", body: { businessDate: form.get("businessDate"), note: form.get("note") } });
      }}
    >
      <Input name="businessDate" type="date" required aria-label="Date" />
      <Input name="note" required placeholder="Note" aria-label="Note" />
      <p className="text-sm text-muted">The request uses the signed-in branch. Approval does not move stock.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save request
      </Button>
    </form>
  );
}

export function StatusAction({ url, label }: { url: string; label: string }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ url, body: {} });
      }}
    >
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        {label}
      </Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}
