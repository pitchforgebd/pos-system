"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFormSubmit } from "@/lib/client/use-form-submit";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

type Option = { id: string; label: string };
type Counter = Option & { group: string };

/** Opens the user's shift: the cash in the drawer now, and which cash account the drawer is (the main cash by default). */
export function OpenShiftForm({ cashAccounts }: { cashAccounts: Option[] }) {
  const { ph } = useI18n();
  const form = useFormSubmit("/api/v1/shifts", (data) => ({ openingCash: data.get("openingCash"), cashAccountId: String(data.get("cashAccountId") || "") || undefined }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <label className="grid gap-1 text-sm">
        {ph("Cash in the drawer now")}
        <Input name="openingCash" required placeholder={ph("Opening cash")} aria-label={ph("Opening cash")} defaultValue="0.00" inputMode="decimal" />
      </label>
      {cashAccounts.length > 1 ? (
        <label className="grid gap-1 text-sm">
          {ph("Drawer (cash account)")}
          <Select name="cashAccountId" aria-label={ph("Drawer")}>
            {cashAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <p className="text-sm text-muted">{ph("The shift starts at once. Opening cash is the drawer count; it is not a journal. Everything you take or pay in cash from now on is in this shift.")}</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        {ph("Open shift")}
      </Button>
    </form>
  );
}

/** Cash in or out of the drawer that is not a sale: the other side is an account the user picks (a bank, the owner, an expense ...). */
export function MovementForm({ shiftId, counters }: { shiftId: string; counters: Counter[] }) {
  const { ph } = useI18n();
  const form = useFormSubmit(`/api/v1/shifts/${shiftId}/movements`, (data) => ({
    direction: data.get("direction"),
    amount: data.get("amount"),
    counterAccountId: data.get("counterAccountId"),
    reason: String(data.get("reason") || "") || null,
  }));
  const groups = [...new Set(counters.map((counter) => counter.group))];
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Select name="direction" aria-label={ph("Direction")}>
        <option value="IN">{ph("Cash in (into the drawer)")}</option>
        <option value="OUT">{ph("Cash out (from the drawer)")}</option>
      </Select>
      <Input name="amount" required placeholder={ph("Amount")} aria-label={ph("Amount")} inputMode="decimal" />
      <label className="grid gap-1 text-sm">
        {ph("The other side (where it comes from or goes to)")}
        <Select name="counterAccountId" required aria-label={ph("The other account")} defaultValue="">
          <option value="" disabled>
            {ph("Choose an account")}
          </option>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {counters
                .filter((counter) => counter.group === group)
                .map((counter) => (
                  <option key={counter.id} value={counter.id}>
                    {counter.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
      </label>
      <Input name="reason" placeholder={ph("Reason")} aria-label={ph("Reason")} />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" variant="secondary" loading={form.pending}>
        {ph("Move cash")}
      </Button>
    </form>
  );
}

/** The count: by notes and coins (the total is worked out), or one total. */
export function CountForm({ shiftId, denominations, expected }: { shiftId: string; denominations: readonly number[]; expected: string }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [total, setTotal] = useState("");
  const byNotes = Object.values(counts).some((value) => value !== "");
  const counted = denominations.reduce((sum, value) => sum + value * (Number.parseInt(counts[String(value)] ?? "", 10) || 0), 0);
  const shown = byNotes ? counted.toFixed(2) : total;
  const gap = shown !== "" && Number.isFinite(Number(shown)) ? (Number(shown) - Number(expected)).toFixed(2) : null;

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const body = byNotes
          ? { denominations: Object.fromEntries(Object.entries(counts).filter(([, value]) => value !== "").map(([key, value]) => [key, Math.max(0, Number.parseInt(value, 10) || 0)])) }
          : { actualCash: total };
        void submit({ url: `/api/v1/shifts/${shiftId}/closing`, body });
      }}
    >
      <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <legend className="mb-1 text-sm">{ph("Count by notes and coins")}</legend>
        {denominations.map((value) => (
          <label key={value} className="grid gap-1 text-xs text-muted">
            {value}
            <Input
              inputMode="numeric"
              aria-label={`Number of ${value} notes or coins`}
              value={counts[String(value)] ?? ""}
              onChange={(event) => setCounts((current) => ({ ...current, [String(value)]: event.target.value.replace(/\D/g, "") }))}
            />
          </label>
        ))}
      </fieldset>
      {byNotes ? null : (
        <label className="grid gap-1 text-sm">
          {ph("Or the total counted")}
          <Input name="actualCash" placeholder={ph("Actual cash")} aria-label={ph("Actual cash")} inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} />
        </label>
      )}
      <p className="text-sm">
        {ph("Counted")} <strong>{shown || "0.00"}</strong> {ph("· should hold")} <strong>{expected}</strong>
        {gap !== null ? <> {ph("· difference")} <strong>{gap}</strong></> : null}
      </p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" variant="secondary" loading={pending} disabled={!byNotes && total.trim() === ""}>
        {ph("Count drawer")}
      </Button>
    </form>
  );
}

export function CloseShiftForm({ shiftId, difference }: { shiftId: string; difference: string | null }) {
  const { ph } = useI18n();
  const form = useFormSubmit(`/api/v1/shifts/${shiftId}/close`, () => ({}));
  const gap = Number(difference ?? 0);
  return (
    <form className="grid max-w-xl gap-2" onSubmit={form.onSubmit}>
      {gap !== 0 ? <p className="text-sm">{gap < 0 ? `The drawer is short by ${Math.abs(gap).toFixed(2)}: closing books it as Miscellaneous expense.` : `The drawer is over by ${gap.toFixed(2)}: closing books it as Other income.`}</p> : null}
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        {ph("Close shift")}
      </Button>
    </form>
  );
}

/** The counted drawer goes to another user; when it goes into another cash account (the main cash, a safe) that is a transfer and leaves the drawer. */
export function HandoverForm({ shiftId, users, cashAccounts }: { shiftId: string; users: Option[]; cashAccounts: Option[] }) {
  const { ph } = useI18n();
  const form = useFormSubmit(`/api/v1/shifts/${shiftId}/handover`, (data) => ({
    toUserId: data.get("toUserId"),
    amount: data.get("amount"),
    toAccountId: String(data.get("toAccountId") || "") || undefined,
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Select name="toUserId" required aria-label={ph("Hand over to")} defaultValue="">
        <option value="" disabled>
          {ph("Hand over to")}
        </option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.label}
          </option>
        ))}
      </Select>
      <Input name="amount" required placeholder={ph("Amount")} aria-label={ph("Handover amount")} inputMode="decimal" />
      {cashAccounts.length > 0 ? (
        <label className="grid gap-1 text-sm">
          {ph("Put the cash into (optional)")}
          <Select name="toAccountId" aria-label={ph("Cash account the drawer goes into")} defaultValue="">
            <option value="">{ph("Only record the handover")}</option>
            {cashAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <Button type="submit" variant="secondary" loading={form.pending}>
        {ph("Hand over")}
      </Button>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
    </form>
  );
}
