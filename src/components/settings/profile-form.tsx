"use client";

import { type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

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
      <Input name="name" required defaultValue={name} placeholder="Shop name" aria-label="Shop name" />
      <Input name="phone" defaultValue={phone} placeholder="Phone" aria-label="Phone" />
      <textarea
        name="address"
        defaultValue={address}
        aria-label="Address"
        placeholder="Address"
        className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />
      <Input name="bin" defaultValue={bin} placeholder="BIN" aria-label="BIN" />
      <Input name="tin" defaultValue={tin} placeholder="TIN" aria-label="TIN" />
      <Input name="logoUrl" defaultValue={logoUrl} placeholder="Logo URL" aria-label="Logo URL" />
      <Input name="pointsPerHundred" defaultValue={pointsPerHundred} placeholder="Points per 100 taka" aria-label="Points per hundred" />
      <Input name="takaPerPoint" defaultValue={takaPerPoint} placeholder="Taka per point" aria-label="Taka per point" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save shop profile
      </Button>
    </form>
  );
}
