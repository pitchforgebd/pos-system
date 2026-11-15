"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormSubmit } from "@/lib/client/use-form-submit";
import { smsParts } from "@/modules/sms/parts";
import { smsVariables } from "@/modules/sms/templates";

type Option = { id: string; label: string };

export function TemplateForm() {
  const form = useFormSubmit("/api/v1/sms/templates", (data) => ({
    name: data.get("name"),
    kind: data.get("kind"),
    body: data.get("body"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Input name="name" required placeholder="Template name" aria-label="Template name" />
      <select name="kind" aria-label="Kind" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="BILL">Bill (after a sale)</option>
        <option value="DUE_COLLECTION">Payment received</option>
        <option value="DUE_REMINDER">Due reminder</option>
        <option value="ORDER_STATUS">Order status</option>
        <option value="OFFER">Offer</option>
      </select>
      <textarea name="body" required aria-label="Message" className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm" placeholder="Hello {customer_name}" />
      <p className="text-sm text-muted">Only these variables in braces are allowed: {smsVariables.map((name) => `{${name}}`).join(" ")}. The newest active template of a kind is used for automatic messages (a sale, a payment, an order).</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        Save template
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
      <p className="text-sm">Left on the SMS account <span className="font-semibold">{balance ?? "the provider does not say"}</span></p>
      <div className="flex flex-wrap gap-3 text-sm">
        {(
          [
            ["new", "Add New"],
            ["customers", "Customers"],
            ["suppliers", "Suppliers"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? "font-semibold" : "text-muted"} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "new" ? null : (
        <label className="grid gap-1 text-sm">
          {tab === "customers" ? "Customer" : "Supplier"}
          <select
            aria-label={tab === "customers" ? "Customer" : "Supplier"}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            defaultValue=""
            onChange={(event) => {
              const party = parties.find((item) => item.id === event.target.value);
              setRecipient(party?.phone ?? "");
            }}
          >
            <option value="">Choose a name</option>
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name}
                {party.phone ? ` · ${party.phone}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <Input name="recipient" required placeholder="Phone" aria-label="Phone" value={recipient} onChange={(event) => setRecipient(event.target.value)} />
      <select name="templateId" aria-label="Template" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">No template</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.label}
          </option>
        ))}
      </select>
      <textarea
        name="body"
        aria-label="Message"
        className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        placeholder="Message, if no template is chosen"
        onChange={(event) => setText(event.target.value)}
      />
      <p className="text-sm text-muted">
        {parts.length} characters ({parts.encoding === "UNICODE" ? "Bangla/Unicode: 70 per SMS, 67 per part" : "160 per SMS, 153 per part"}) · {parts.parts} SMS
      </p>
      {smsVariables.map((name) => (
        <Input key={name} name={name} placeholder={name} aria-label={name} />
      ))}
      <p className="text-sm text-muted">The message goes to the outbox and is sent right after. A failure is tried again three times; without a provider set up it waits.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        Send SMS
      </Button>
    </form>
  );
}

export function SettingsForm({ sender, provider }: { sender: string; provider: string }) {
  const form = useFormSubmit("/api/v1/sms/settings", (data) => ({
    sender: data.get("sender"),
    provider: String(data.get("provider") || "") || null,
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Input name="sender" required defaultValue={sender} placeholder="Sender name" aria-label="Sender name" />
      <Input name="provider" defaultValue={provider} placeholder="Provider label" aria-label="Provider label" />
      <p className="text-sm text-muted">Credentials are not stored here.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        Save settings
      </Button>
    </form>
  );
}

export function RetryForm({ messageId }: { messageId: string }) {
  const form = useFormSubmit(`/api/v1/sms/messages/${messageId}/retry`, () => ({}));
  return (
    <form onSubmit={form.onSubmit}>
      <Button type="submit" variant="secondary" size="sm" loading={form.pending}>
        Retry
      </Button>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
    </form>
  );
}

/** Sends what waits in the outbox now (it normally goes by itself right after it is written). */
export function SendWaitingForm({ waiting, configured }: { waiting: number; configured: boolean }) {
  const form = useFormSubmit<{ sent: number; retrying: number; failed: number; configured: boolean }>("/api/v1/sms/outbox", () => ({}));
  if (!configured) {
    return <p className="text-sm text-warning">{waiting} message(s) wait in the outbox: no SMS provider is set up yet. They go out once one is.</p>;
  }
  return (
    <form className="flex flex-wrap items-center gap-3" onSubmit={form.onSubmit}>
      <p className="text-sm">{waiting} message(s) wait in the outbox.</p>
      <Button type="submit" variant="secondary" size="sm" loading={form.pending}>
        Send them now
      </Button>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
    </form>
  );
}
