"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFormSubmit } from "@/lib/client/use-form-submit";
import { useI18n } from "@/lib/i18n/provider";

type Option = { id: string; label: string };
type Category = { value: string; label: string };

const optional = (data: FormData, name: string) => String(data.get(name) ?? "").trim() || undefined;

/** Adds an asset: bought now (paid from an account, or owed to a vendor) or one the shop already had (with what was written off before). */
export function AssetForm({ categories, accounts, vendors, today }: { categories: Category[]; accounts: Option[]; vendors: Option[]; today: string }) {
  const { ph } = useI18n();
  const [kind, setKind] = useState<"BUY" | "OPENING">("BUY");
  const [paidWith, setPaidWith] = useState<"ACCOUNT" | "CREDIT">("ACCOUNT");
  const form = useFormSubmit<{ id: string }>(
    "/api/v1/assets",
    (data) => ({
      kind,
      code: optional(data, "code"),
      name: data.get("name"),
      category: data.get("category"),
      purchaseDate: data.get("purchaseDate"),
      cost: data.get("cost"),
      salvageValue: optional(data, "salvageValue"),
      usefulLifeMonths: Number(data.get("usefulLifeMonths")),
      location: optional(data, "location"),
      note: optional(data, "note"),
      ...(kind === "BUY"
        ? { paidWith, moneyAccountId: paidWith === "ACCOUNT" ? optional(data, "moneyAccountId") : undefined, vendorId: paidWith === "CREDIT" ? optional(data, "vendorId") : undefined }
        : { accumulated: String(data.get("accumulated") || "0"), asOf: optional(data, "asOf") }),
    }),
    { goTo: (asset) => `/accounting/assets/${asset.id}` },
  );

  return (
    <form className="grid max-w-3xl gap-3" onSubmit={form.onSubmit}>
      <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label={ph("How the asset comes in")}>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" checked={kind === "BUY"} onChange={() => setKind("BUY")} /> {ph("Bought now")}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" checked={kind === "OPENING"} onChange={() => setKind("OPENING")} /> {ph("Already owned (opening)")}
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm sm:col-span-2">
          {ph("Name")}
          <Input name="name" required maxLength={191} placeholder={ph("Delivery van")} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Code (optional)")}
          <Input name="code" maxLength={32} placeholder={ph("Made for you")} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Category")}
          <Select name="category" defaultValue="OTHER">
            {categories.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Bought on")}
          <Input name="purchaseDate" type="date" required defaultValue={today} max={today} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Location")}
          <Input name="location" maxLength={191} placeholder={ph("Main shop")} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Cost")}
          <Input name="cost" required inputMode="decimal" placeholder="0.00" />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Value left at the end")}
          <Input name="salvageValue" inputMode="decimal" placeholder="0.00" />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Useful life (months)")}
          <Input name="usefulLifeMonths" required type="number" min={1} max={600} defaultValue={60} />
        </label>
      </div>
      {kind === "BUY" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            {ph("Paid")}
            <Select value={paidWith} onChange={(event) => setPaidWith(event.target.value as "ACCOUNT" | "CREDIT")} aria-label={ph("Paid")}>
              <option value="ACCOUNT">{ph("From an account (cash, bank, mobile)")}</option>
              <option value="CREDIT">{ph("Not yet: owed to a vendor")}</option>
            </Select>
          </label>
          {paidWith === "ACCOUNT" ? (
            <label className="grid gap-1 text-sm">
              {ph("Paid from")}
              <Select name="moneyAccountId" required>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <label className="grid gap-1 text-sm">
              {ph("Owed to")}
              <Select name="vendorId" required defaultValue="">
                <option value="" disabled>
                  {ph("Choose a vendor")}
                </option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            {ph("Written off before (accumulated depreciation)")}
            <Input name="accumulated" inputMode="decimal" placeholder="0.00" />
          </label>
          <label className="grid gap-1 text-sm">
            {ph("Opening date")}
            <Input name="asOf" type="date" defaultValue={today} max={today} />
          </label>
          <p className="text-xs text-muted sm:col-span-2">{ph("It goes in against Opening Balance Equity. What is left is written off over the months of its life still to come, from the month after the opening date.")}</p>
        </div>
      )}
      <Input name="note" maxLength={255} placeholder={ph("Note")} aria-label={ph("Note")} />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        {ph("Add asset")}
      </Button>
    </form>
  );
}

/** Sells or writes off an asset: what it brought (nothing for a write-off) and the account it came into. */
export function DisposeForm({ assetId, accounts, today, bookValue }: { assetId: string; accounts: Option[]; today: string; bookValue: string }) {
  const { ph } = useI18n();
  const [amount, setAmount] = useState("");
  const gain = amount.trim() === "" || !Number.isFinite(Number(amount)) ? null : (Number(amount) - Number(bookValue)).toFixed(2);
  const form = useFormSubmit(`/api/v1/assets/${assetId}/dispose`, (data) => ({
    businessDate: data.get("businessDate"),
    amount: amount.trim() || undefined,
    moneyAccountId: Number(amount) > 0 ? optional(data, "moneyAccountId") : undefined,
    note: optional(data, "note"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          {ph("Date")}
          <Input name="businessDate" type="date" required defaultValue={today} max={today} />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("Sold for (empty to write it off)")}
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" aria-label={ph("Sold for")} />
        </label>
        {Number(amount) > 0 ? (
          <label className="grid gap-1 text-sm sm:col-span-2">
            {ph("Money came into")}
            <Select name="moneyAccountId" required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
      <p className="text-sm">
        {ph("Worth now")} <strong>{bookValue}</strong>
        {gain !== null ? <> · {Number(gain) >= 0 ? ph("gain") : ph("loss")} <strong>{Math.abs(Number(gain)).toFixed(2)}</strong></> : null}
      </p>
      <Input name="note" maxLength={255} placeholder={ph("Reason or buyer")} aria-label={ph("Note")} />
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" variant="danger" loading={form.pending}>
        {Number(amount) > 0 ? ph("Sell asset") : ph("Write off asset")}
      </Button>
    </form>
  );
}

/** Posts the month's depreciation after the preview. */
export function RunDepreciationForm({ month, total }: { month: string; total: string }) {
  const { ph } = useI18n();
  const form = useFormSubmit("/api/v1/assets/depreciation", () => ({ month }));
  return (
    <form className="flex flex-wrap items-center gap-3" onSubmit={form.onSubmit}>
      <Button type="submit" loading={form.pending}>
        {ph("Post")} {total} {ph("for")} {month}
      </Button>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
    </form>
  );
}
