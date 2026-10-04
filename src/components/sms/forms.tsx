"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { smsVariables } from "@/modules/sms/templates";

type Option = { id: string; label: string };

function postJson(url: string, body: unknown, idempotent = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idempotent) {
    headers["idempotency-key"] = crypto.randomUUID();
  }
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).then(async (response) => {
    const payload = (await response.json()) as { error?: { message?: string } };
    return { ok: response.ok, message: payload.error?.message ?? "" };
  });
}

function useSubmit(url: string, body: (form: FormData) => unknown, idempotent = false) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    void postJson(url, body(new FormData(event.currentTarget)), idempotent).then((result) => {
      if (!result.ok) {
        setMessage(result.message || "The SMS was not saved.");
        setPending(false);
        return;
      }
      window.location.reload();
    });
  }
  return { message, pending, onSubmit };
}

export function TemplateForm() {
  const form = useSubmit("/api/v1/sms/templates", (data) => ({
    name: data.get("name"),
    kind: data.get("kind"),
    body: data.get("body"),
  }));
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <Input name="name" required placeholder="Template name" aria-label="Template name" />
      <select name="kind" aria-label="Kind" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="BILL">Bill</option>
        <option value="DUE_COLLECTION">Due collection</option>
      </select>
      <textarea name="body" required aria-label="Message" className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm" placeholder="Hello {customer_name}" />
      <p className="text-sm text-muted">Only the named variables in braces are allowed. The text is not executed.</p>
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
  const [characters, setCharacters] = useState(0);
  const form = useSubmit("/api/v1/sms/messages", (data) => {
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
  }, true);
  const parties = tab === "customers" ? customers : suppliers;
  return (
    <form className="grid max-w-xl gap-3" onSubmit={form.onSubmit}>
      <p className="text-sm">Balance <span className="font-semibold">{balance ?? "not set"}</span></p>
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
        onChange={(event) => setCharacters(event.target.value.length)}
      />
      <p className="text-sm text-muted">{characters} characters</p>
      {smsVariables.map((name) => (
        <Input key={name} name={name} placeholder={name} aria-label={name} />
      ))}
      <p className="text-sm text-muted">Without a provider URL, the message is saved as failed and no journal is posted.</p>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
      <Button type="submit" loading={form.pending}>
        Send SMS
      </Button>
    </form>
  );
}

export function SettingsForm({ sender, provider }: { sender: string; provider: string }) {
  const form = useSubmit("/api/v1/sms/settings", (data) => ({
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
  const form = useSubmit(`/api/v1/sms/messages/${messageId}/retry`, () => ({}), true);
  return (
    <form onSubmit={form.onSubmit}>
      <Button type="submit" variant="secondary" size="sm" loading={form.pending}>
        Retry
      </Button>
      {form.message ? <p className="text-sm text-error">{form.message}</p> : null}
    </form>
  );
}
