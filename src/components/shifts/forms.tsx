"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormSubmit } from "@/lib/client/use-form-submit";

type Option = { id: string; label: string };

export function OpenShiftForm() {
  const form = useFormSubmit("/api/v1/shifts", (data) => ({ openingCash: data.get("openingCash") }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Input name="openingCash" required placeholder="Opening cash" aria-label="Opening cash" defaultValue="0.00" />
      <p className="text-sm text-muted">Opening cash is the drawer count. It is not a journal.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        Open shift
      </Button>
    </form>
  );
}

export function ActivateShiftForm({ shiftId }: { shiftId: string }) {
  const form = useFormSubmit(`/api/v1/shifts/${shiftId}/activate`, () => ({}));
  return (
    <form onSubmit={form.onSubmit}>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        Start shift
      </Button>
    </form>
  );
}

export function MovementForm({ shiftId }: { shiftId: string }) {
  const form = useFormSubmit(`/api/v1/shifts/${shiftId}/movements`, (data) => ({
    direction: data.get("direction"),
    amount: data.get("amount"),
    reason: String(data.get("reason") || "") || null,
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="direction" aria-label="Direction" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="IN">Cash in</option>
        <option value="OUT">Cash out</option>
      </select>
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <Input name="reason" placeholder="Reason" aria-label="Reason" />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" variant="secondary" loading={form.pending}>
        Move cash
      </Button>
    </form>
  );
}

export function CountForm({ shiftId }: { shiftId: string }) {
  const form = useFormSubmit(`/api/v1/shifts/${shiftId}/closing`, (data) => ({ actualCash: data.get("actualCash") }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Input name="actualCash" required placeholder="Actual cash" aria-label="Actual cash" />
      <p className="text-sm text-muted">Expected cash is opening plus cash sales plus cash in, minus cash out and refunds.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" variant="secondary" loading={form.pending}>
        Count drawer
      </Button>
    </form>
  );
}

export function CloseShiftForm({ shiftId }: { shiftId: string }) {
  const form = useFormSubmit(`/api/v1/shifts/${shiftId}/close`, () => ({}));
  return (
    <form onSubmit={form.onSubmit}>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        Close shift
      </Button>
    </form>
  );
}

export function HandoverForm({ shiftId, users }: { shiftId: string; users: Option[] }) {
  const form = useFormSubmit(`/api/v1/shifts/${shiftId}/handover`, (data) => ({
    toUserId: data.get("toUserId"),
    amount: data.get("amount"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <select name="toUserId" required aria-label="Hand over to" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">User</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.label}
          </option>
        ))}
      </select>
      <Input name="amount" required placeholder="Amount" aria-label="Handover amount" />
      <p className="text-sm text-muted">A handover does not change expected cash.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" variant="secondary" loading={form.pending}>
        Hand over
      </Button>
    </form>
  );
}
