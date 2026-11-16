"use client";

import { type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function ProfileForm({
  name,
  phone,
  address,
  bin,
  tin,
  logoUrl,
  pointsPerHundred,
  takaPerPoint,
  booksStartOn,
}: {
  name: string;
  phone: string;
  address: string;
  bin: string;
  tin: string;
  logoUrl: string;
  pointsPerHundred: string;
  takaPerPoint: string;
  booksStartOn: string;
}) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit({
      url: "/api/v1/settings/profile",
      body: {
        name: data.get("name"),
        phone: String(data.get("phone") || "") || null,
        address: String(data.get("address") || "") || null,
        bin: String(data.get("bin") || "") || null,
        tin: String(data.get("tin") || "") || null,
        logoUrl: String(data.get("logoUrl") || "") || null,
        pointsPerHundred: String(data.get("pointsPerHundred") || "") || null,
        takaPerPoint: String(data.get("takaPerPoint") || "") || null,
        booksStartOn: String(data.get("booksStartOn") || "") || null,
      },
    });
  }

  return (
    <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
      <Field label={ph("Shop name")}>
        <Input name="name" required defaultValue={name} />
      </Field>
      <Field label={ph("Phone")}>
        <Input name="phone" defaultValue={phone} />
      </Field>
      <Field label={ph("Address")}>
        <textarea name="address" defaultValue={address} className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={ph("BIN")}>
          <Input name="bin" defaultValue={bin} />
        </Field>
        <Field label={ph("TIN")}>
          <Input name="tin" defaultValue={tin} />
        </Field>
      </div>
      <Field label={ph("Logo URL")} hint={ph("Printed on invoices and quotations.")}>
        <Input name="logoUrl" defaultValue={logoUrl} />
      </Field>
      <Field label={ph("The day the books start")} hint={ph("Opening cash, bank and mobile balances, customers' old dues and vendors' old payables are dated this day. Leave it blank to date them the day they are entered.")}>
        <Input name="booksStartOn" type="date" defaultValue={booksStartOn} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={ph("Points per 100 taka")}>
          <Input name="pointsPerHundred" defaultValue={pointsPerHundred} />
        </Field>
        <Field label={ph("Taka per point")}>
          <Input name="takaPerPoint" defaultValue={takaPerPoint} />
        </Field>
      </div>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Save shop profile")}
      </Button>
    </form>
  );
}
