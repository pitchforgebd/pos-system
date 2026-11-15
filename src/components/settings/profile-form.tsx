"use client";

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

export function ProfileForm({
  name,
  phone,
  address,
  bin,
  tin,
  logoUrl,
  pointsPerHundred,
  takaPerPoint,
}: {
  name: string;
  phone: string;
  address: string;
  bin: string;
  tin: string;
  logoUrl: string;
  pointsPerHundred: string;
  takaPerPoint: string;
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
      },
    });
  }

  return (
    <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
      <Input name="name" required defaultValue={name} placeholder={ph("Shop name")} aria-label={ph("Shop name")} />
      <Input name="phone" defaultValue={phone} placeholder={ph("Phone")} aria-label={ph("Phone")} />
      <textarea
        name="address"
        defaultValue={address}
        aria-label={ph("Address")}
        placeholder={ph("Address")}
        className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />
      <Input name="bin" defaultValue={bin} placeholder={ph("BIN")} aria-label={ph("BIN")} />
      <Input name="tin" defaultValue={tin} placeholder={ph("TIN")} aria-label={ph("TIN")} />
      <Input name="logoUrl" defaultValue={logoUrl} placeholder={ph("Logo URL")} aria-label={ph("Logo URL")} />
      <Input name="pointsPerHundred" defaultValue={pointsPerHundred} placeholder={ph("Points per 100 taka")} aria-label={ph("Points per hundred")} />
      <Input name="takaPerPoint" defaultValue={takaPerPoint} placeholder={ph("Taka per point")} aria-label={ph("Taka per point")} />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Save shop profile")}
      </Button>
    </form>
  );
}
