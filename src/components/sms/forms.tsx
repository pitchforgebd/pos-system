"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormSubmit } from "@/lib/client/use-form-submit";
import { smsParts } from "@/modules/sms/parts";
import { smsVariables } from "@/modules/sms/templates";
import { useI18n } from "@/lib/i18n/provider";

type Option = { id: string; label: string };

export function TemplateForm() {
  const { ph } = useI18n();
  const form = useFormSubmit("/api/v1/sms/templates", (data) => ({
    name: data.get("name"),
    kind: data.get("kind"),
    body: data.get("body"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Input name="name" required placeholder={ph("Template name")} aria-label={ph("Template name")} />
      <select name="kind" aria-label={ph("Kind")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="BILL">{ph("Bill (after a sale)")}</option>
        <option value="DUE_COLLECTION">{ph("Payment received")}</option>
        <option value="DUE_REMINDER">{ph("Due reminder")}</option>
        <option value="ORDER_STATUS">{ph("Order status")}</option>
        <option value="OFFER">{ph("Offer")}</option>
      </select>
      <textarea name="body" required aria-label={ph("Message")} className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm" placeholder={ph("Hello {customer_name}")} />
      <p className="text-sm text-muted">{ph("Only these variables in braces are allowed:")} {smsVariables.map((name) => `{${name}}`).join(" ")}{ph(". The newest active template of a kind is used for automatic messages (a sale, a payment, an order).")}</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        {ph("Save template")}
      </Button>
    </form>
  );
}

export function SendForm({
  templates,
  customers,
  suppliers,
  balance,
}: {
  templates: Option[];
  customers: { id: string; name: string; phone: string | null }[];
  suppliers: { id: string; name: string; phone: string | null }[];
  balance: string | null;
}) {
  const { ph } = useI18n();
  const [tab, setTab] = useState<"new" | "customers" | "suppliers">("new");
  const [recipient, setRecipient] = useState("");
  const [text, setText] = useState("");
  const parts = smsParts(text);
  const form = useFormSubmit("/api/v1/sms/messages", (data) => {
    const variables: Record<string, string> = {};
    for (const name of smsVariables) {
      const value = String(data.get(name) || "");
      if (value) {
        variables[name] = value;
      }
    }
    return {
      recipient: data.get("recipient"),
      templateId: String(data.get("templateId") || "") || null,
      body: String(data.get("body") || "") || null,
      variables,
    };
  });
  const parties = tab === "customers" ? customers : suppliers;
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <p className="text-sm">{ph("Left on the SMS account")} <span className="font-semibold">{balance ?? ph("the provider does not say")}</span></p>
      <div className="flex flex-wrap gap-3 text-sm">
        {(
          [
            ["new", "Add New"],
            ["customers", "Customers"],
            ["suppliers", "Suppliers"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? "font-semibold" : "text-muted"} onClick={() => setTab(value)}>
            {ph(label)}
          </button>
        ))}
      </div>
      {tab === "new" ? null : (
        <label className="grid gap-1 text-sm">
          {tab === "customers" ? ph("Customer") : ph("Supplier")}
          <select
            aria-label={tab === "customers" ? ph("Customer") : ph("Supplier")}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            defaultValue=""
            onChange={(event) => {
              const party = parties.find((item) => item.id === event.target.value);
              setRecipient(party?.phone ?? "");
            }}
          >
            <option value="">{ph("Choose a name")}</option>
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name}
                {party.phone ? ` · ${party.phone}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <Input name="recipient" required placeholder={ph("Phone")} aria-label={ph("Phone")} value={recipient} onChange={(event) => setRecipient(event.target.value)} />
      <select name="templateId" aria-label={ph("Template")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">{ph("No template")}</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.label}
          </option>
        ))}
      </select>
      <textarea
        name="body"
        aria-label={ph("Message")}
        className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        placeholder={ph("Message, if no template is chosen")}
        onChange={(event) => setText(event.target.value)}
      />
      <p className="text-sm text-muted">
        {parts.length} {ph("characters (")}{parts.encoding === "UNICODE" ? ph("Bangla/Unicode: 70 per SMS, 67 per part") : ph("160 per SMS, 153 per part")}) · {parts.parts} {ph("SMS")}
      </p>
      {smsVariables.map((name) => (
        <Input key={name} name={name} placeholder={name} aria-label={name} />
      ))}
      <p className="text-sm text-muted">{ph("The message goes to the outbox and is sent right after. A failure is tried again three times; without a provider set up it waits.")}</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        {ph("Send SMS")}
      </Button>
    </form>
  );
}

export function SettingsForm({ sender, provider }: { sender: string; provider: string }) {
  const { ph } = useI18n();
  const form = useFormSubmit("/api/v1/sms/settings", (data) => ({
    sender: data.get("sender"),
    provider: String(data.get("provider") || "") || null,
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Input name="sender" required defaultValue={sender} placeholder={ph("Sender name")} aria-label={ph("Sender name")} />
      <Input name="provider" defaultValue={provider} placeholder={ph("Provider label")} aria-label={ph("Provider label")} />
      <p className="text-sm text-muted">{ph("Credentials are not stored here.")}</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        {ph("Save settings")}
      </Button>
    </form>
  );
}

export function RetryForm({ messageId }: { messageId: string }) {
  const { ph } = useI18n();
  const form = useFormSubmit(`/api/v1/sms/messages/${messageId}/retry`, () => ({}));
  return (
    <form onSubmit={form.onSubmit}>
      <Button type="submit" variant="secondary" size="sm" loading={form.pending}>
        {ph("Retry")}
      </Button>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
    </form>
  );
}

/** Sends what waits in the outbox now (it normally goes by itself right after it is written). */
export function SendWaitingForm({ waiting, configured }: { waiting: number; configured: boolean }) {
  const { ph } = useI18n();
  const form = useFormSubmit<{ sent: number; retrying: number; failed: number; configured: boolean }>("/api/v1/sms/outbox", () => ({}));
  if (!configured) {
    return <p className="text-sm text-warning">{waiting} {ph("message(s) wait in the outbox: no SMS provider is set up yet. They go out once one is.")}</p>;
  }
  return (
    <form className="flex flex-wrap items-center gap-3" onSubmit={form.onSubmit}>
      <p className="text-sm">{waiting} {ph("message(s) wait in the outbox.")}</p>
      <Button type="submit" variant="secondary" size="sm" loading={form.pending}>
        {ph("Send them now")}
      </Button>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
    </form>
  );
}
