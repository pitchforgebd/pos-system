"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useSubmit } from "@/lib/client/use-submit";
import { smsParts } from "@/modules/sms/parts";

// The campaign builder (P10 tasks 8-9): who (the segment), what (the message), then a preview with the number of people, SMS parts and cost,
// then send. A due reminder is the same with "owes" filters.

type Option = { id: string; label: string };
type Filter = { field: string; value: string };
type Preview = { recipients: number; totalParts: number; cost: string | null; partsEach: { encoding: string; parts: number }; sample: Array<{ name: string; phone: string; body: string }>; tooMany: boolean };

const many = (element: HTMLSelectElement) => [...element.selectedOptions].map((option) => option.value).filter(Boolean);

export function CampaignForm({
  kind,
  districts,
  types,
  categories,
  products,
  templates,
  canSend,
}: {
  kind: "OFFER" | "DUE_REMINDER";
  districts: Option[];
  types: Option[];
  categories: Option[];
  products: Option[];
  templates: Array<Option & { body: string }>;
  canSend: boolean;
}) {
  const reminder = kind === "DUE_REMINDER";
  const [body, setBody] = useState(reminder ? "{customer_name}, your due at {shop_name} is {due_amount} Tk. Please pay. Thank you." : "{customer_name}, {offer_text} - {shop_name}");
  const [offerText, setOfferText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filtersKey, setFiltersKey] = useState("");
  const look = useSubmit();
  const send = useSubmit();
  const parts = smsParts(body.replace("{offer_text}", offerText));

  function filtersOf(form: HTMLFormElement): Filter[] {
    const out: Filter[] = [];
    const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement | null;
    const value = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "").trim();
    for (const id of many(select("district") as HTMLSelectElement)) out.push({ field: "DISTRICT", value: id });
    for (const id of many(select("type") as HTMLSelectElement)) out.push({ field: "CUSTOMER_TYPE", value: id });
    for (const id of many(select("category") as HTMLSelectElement)) out.push({ field: "BOUGHT_CATEGORY", value: id });
    for (const id of many(select("product") as HTMLSelectElement)) out.push({ field: "BOUGHT_PRODUCT", value: id });
    const pairs: Array<[string, string]> = [
      ["before", "LAST_PURCHASE_BEFORE"],
      ["after", "LAST_PURCHASE_AFTER"],
      ["min", "TOTAL_PURCHASE_MIN"],
      ["max", "TOTAL_PURCHASE_MAX"],
      ["due", "HAS_DUE"],
      ["late", "DUE_OLDER_THAN_DAYS"],
    ];
    for (const [name, field] of pairs) {
      if (value(name)) out.push({ field, value: value(name) });
    }
    return out;
  }

  return (
    <form
      className="grid max-w-4xl gap-4"
      onChange={() => setPreview(null)}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const filters = filtersOf(form);
        const key = JSON.stringify([filters, body, offerText]);
        if (!preview || filtersKey !== key) {
          void look.submit<Preview>({ url: "/api/v1/sms/campaigns/preview", body: { body, offerText: offerText || null, filters } }, { quiet: true, onSuccess: (data) => { setPreview(data); setFiltersKey(key); } });
          return;
        }
        const name = String((form.elements.namedItem("name") as HTMLInputElement).value || "").trim();
        void send.submit<{ id: string }>({ url: "/api/v1/sms/campaigns", body: { name, kind, body, offerText: offerText || null, filters, templateId: String((form.elements.namedItem("templateId") as HTMLSelectElement | null)?.value || "") || null } }, { goTo: (data) => `/sms/campaigns/${data.id}` });
      }}
    >
      <fieldset className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Who</legend>
        <label className="grid gap-1 text-sm">
          Districts (none: all)
          <select name="district" multiple size={6} className="rounded-md border border-border bg-surface px-2 py-1 text-sm">
            {districts.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Customer types (none: all)
          <select name="type" multiple size={6} className="rounded-md border border-border bg-surface px-2 py-1 text-sm">
            {types.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Last bought before
          <Input name="before" type="date" />
        </label>
        <label className="grid gap-1 text-sm">
          Last bought on or after
          <Input name="after" type="date" />
        </label>
        <label className="grid gap-1 text-sm">
          Bought in all at least
          <Input name="min" inputMode="decimal" placeholder="0.00" />
        </label>
        <label className="grid gap-1 text-sm">
          Bought in all at most
          <Input name="max" inputMode="decimal" placeholder="no limit" />
        </label>
        <label className="grid gap-1 text-sm">
          Owes something
          <Select name="due" defaultValue={reminder ? "YES" : ""}>
            <option value="">Either</option>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          An invoice unpaid for more than
          <Select name="late" defaultValue={reminder ? "TERMS" : ""}>
            <option value="">Any time</option>
            <option value="TERMS">Their days to pay</option>
            <option value="7">7 days</option>
            <option value="15">15 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          Bought from categories
          <select name="category" multiple size={4} className="rounded-md border border-border bg-surface px-2 py-1 text-sm">
            {categories.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Bought these products
          <select name="product" multiple size={4} className="rounded-md border border-border bg-surface px-2 py-1 text-sm">
            {products.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted sm:col-span-2">Several districts (or types ...) mean any of them; different filters must all hold. Customers who asked for no offer SMS, and those without a mobile number, are never included.</p>
      </fieldset>

      <fieldset className="grid gap-3 rounded-xl border border-border p-3">
        <legend className="px-1 text-sm font-semibold">What</legend>
        <label className="grid gap-1 text-sm">
          Campaign name
          <Input name="name" required maxLength={191} defaultValue={reminder ? "Due reminder" : ""} placeholder="Seed week offer" />
        </label>
        {templates.length > 0 ? (
          <label className="grid gap-1 text-sm">
            Start from a template
            <Select name="templateId" defaultValue="" onChange={(event) => setBody(templates.find((row) => row.id === event.target.value)?.body ?? body)}>
              <option value="">No template</option>
              {templates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="grid gap-1 text-sm">
          Message
          <textarea value={body} onChange={(event) => setBody(event.target.value)} required maxLength={1000} className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm" aria-label="Message" />
        </label>
        {!reminder ? (
          <label className="grid gap-1 text-sm">
            Offer text ({"{offer_text}"})
            <Input value={offerText} onChange={(event) => setOfferText(event.target.value)} maxLength={500} placeholder="১০% ছাড় সব বীজে, এই সপ্তাহে" />
          </label>
        ) : null}
        <p className="text-xs text-muted">
          Variables: {"{customer_name} {district} {offer_text} {shop_name} {due_amount}"}. About {parts.parts} SMS per customer ({parts.encoding === "UNICODE" ? "Bangla/Unicode: 70 in one SMS, 67 per part" : "160 in one SMS, 153 per part"}); a long name adds more.
        </p>
      </fieldset>

      {preview ? (
        <section className="space-y-2 rounded-xl border border-border p-3" aria-label="Preview">
          <p className="text-sm">
            <strong>{preview.recipients}</strong> customer(s) · <strong>{preview.totalParts}</strong> SMS in all{preview.cost ? <> · about <strong>{preview.cost}</strong> Tk</> : " · set the price per SMS in SMS settings to see the cost"}
          </p>
          {preview.tooMany ? <p className="text-sm text-error">Too many for one campaign: narrow the segment.</p> : null}
          <ul className="space-y-1 text-sm">
            {preview.sample.map((row) => (
              <li key={row.phone} className="rounded-md bg-surface-muted px-2 py-1">
                <span className="text-xs text-muted">
                  {row.name} · {row.phone}
                </span>
                <br />
                {row.body}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {look.message ? <p className="text-sm text-error">{look.message}</p> : null}
      {send.message ? <p className="text-sm text-error">{send.message}</p> : null}
      {preview && preview.recipients > 0 && !preview.tooMany ? (
        canSend ? (
          <Button type="submit" loading={send.pending}>
            Send to {preview.recipients} customer(s)
          </Button>
        ) : (
          <p className="text-sm text-muted">Sending a campaign needs the campaign permission.</p>
        )
      ) : (
        <Button type="submit" variant="secondary" loading={look.pending}>
          Preview
        </Button>
      )}
    </form>
  );
}
