"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

type Option = { id: string; label: string };

export function TypeForm() {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({ url: "/api/v1/customer-types", body: { name: form.get("name") } });
      }}
    >
      <Input name="name" required placeholder={ph("Type name")} aria-label={ph("Type name")} />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Save type")}
      </Button>
    </form>
  );
}

function MoneyForm({
  title,
  url,
  customers,
}: {
  title: string;
  url: string;
  customers: Option[];
}) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: url,
          body: {
            customerId: form.get("customerId"),
            businessDate: form.get("businessDate"),
            amount: form.get("amount"),
            method: form.get("method"),
          },
        });
      }}
    >
      <select name="customerId" required aria-label={ph("Customer")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">{ph("Customer")}</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.label}
          </option>
        ))}
      </select>
      <Input name="businessDate" type="date" required aria-label={ph("Date")} />
      <Input name="amount" required placeholder={ph("Amount")} aria-label={ph("Amount")} />
      <select name="method" required aria-label={ph("Method")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="CASH">{ph("Cash")}</option>
        <option value="BANK">{ph("Bank")}</option>
      </select>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {title}
      </Button>
    </form>
  );
}

export function PaymentForm({ customers }: { customers: Option[] }) {
  const { ph } = useI18n();
  return <MoneyForm title={ph("Collect due")} url="/api/v1/customer-payments" customers={customers} />;
}

export function AdvanceForm({ customers }: { customers: Option[] }) {
  const { ph } = useI18n();
  return <MoneyForm title={ph("Take advance")} url="/api/v1/customer-advances" customers={customers} />;
}

export function InstallmentForm({ customers, invoices }: { customers: Option[]; invoices: Array<Option & { customerId: string | null }> }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  const [customerId, setCustomerId] = useState("");
  const visible = invoices.filter((invoice) => invoice.customerId === customerId);
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/installments",
          body: {
            customerId: form.get("customerId"),
            invoiceId: form.get("invoiceId"),
            amount: form.get("amount"),
            dueOn: form.get("dueOn"),
            interestPercent: String(form.get("interestPercent") || "") || undefined,
          },
        });
      }}
    >
      <select
        name="customerId"
        required
        aria-label={ph("Customer")}
        className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
        onChange={(event) => setCustomerId(event.target.value)}
      >
        <option value="">{ph("Customer")}</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.label}
          </option>
        ))}
      </select>
      <select name="invoiceId" required aria-label={ph("Invoice")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">{ph("Invoice")}</option>
        {visible.map((invoice) => (
          <option key={invoice.id} value={invoice.id}>
            {invoice.label}
          </option>
        ))}
      </select>
      <Input name="amount" required placeholder={ph("Amount")} aria-label={ph("Amount")} />
      <Input name="interestPercent" placeholder={ph("Interest percent, optional")} aria-label={ph("Interest percent")} />
      <Input name="dueOn" type="date" required aria-label={ph("Due date")} />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Add reminder")}
      </Button>
    </form>
  );
}

export function CloseReminder({ id }: { id: string }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ url: `/api/v1/installments/${id}/close` });
      }}
    >
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        {ph("Close reminder")}
      </Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}

export function TierForm() {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/loyalty/tiers",
          body: {
            name: form.get("name"),
            minimumSpend: form.get("minimumSpend"),
            discountPercent: form.get("discountPercent"),
            benefits: String(form.get("benefits") || "") || null,
          },
        });
      }}
    >
      <Input name="name" required placeholder={ph("Tier name")} aria-label={ph("Tier name")} />
      <Input name="minimumSpend" required placeholder={ph("Minimum spend")} aria-label={ph("Minimum spend")} />
      <Input name="discountPercent" required placeholder={ph("Discount percent")} aria-label={ph("Discount percent")} />
      <Input name="benefits" placeholder={ph("Benefits")} aria-label={ph("Benefits")} />
      <p className="text-sm text-muted">{ph("The discount percent is stored. Sales do not use it.")}</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Save tier")}
      </Button>
    </form>
  );
}

export function CardForm({ customers, tiers }: { customers: Option[]; tiers: Option[] }) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          url: "/api/v1/loyalty/cards",
          body: {
            customerId: form.get("customerId"),
            tierId: String(form.get("tierId") || "") || null,
            number: form.get("number"),
            cardType: form.get("cardType"),
            issuedOn: form.get("issuedOn"),
            expiresOn: String(form.get("expiresOn") || "") || null,
          },
        });
      }}
    >
      <Input name="number" required placeholder={ph("Card number")} aria-label={ph("Card number")} />
      <Input name="cardType" required placeholder={ph("Card type")} aria-label={ph("Card type")} />
      <select name="customerId" required aria-label={ph("Customer")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">{ph("Customer")}</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.label}
          </option>
        ))}
      </select>
      <select name="tierId" aria-label={ph("Tier")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">{ph("No tier")}</option>
        {tiers.map((tier) => (
          <option key={tier.id} value={tier.id}>
            {tier.label}
          </option>
        ))}
      </select>
      <Input name="issuedOn" type="date" required aria-label={ph("Issued")} />
      <Input name="expiresOn" type="date" aria-label={ph("Expires")} />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {ph("Issue card")}
      </Button>
    </form>
  );
}

export function CrmForms({
  contacts,
  segments,
  users,
}: {
  contacts: Option[];
  segments: Option[];
  users: Option[];
}) {
  const { ph } = useI18n();
  const { submit, pending, message } = useSubmit();
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void submit({
            url: "/api/v1/crm/contacts",
            body: {
              name: form.get("name"),
              phone: String(form.get("phone") || "") || null,
              segmentId: String(form.get("segmentId") || "") || null,
            },
          });
        }}
      >
        <Input name="name" required placeholder={ph("Contact name")} aria-label={ph("Contact name")} />
        <Input name="phone" placeholder={ph("Phone")} aria-label={ph("Phone")} />
        <select name="segmentId" aria-label={ph("Segment")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
          <option value="">{ph("No segment")}</option>
          {segments.map((segment) => (
            <option key={segment.id} value={segment.id}>
              {segment.label}
            </option>
          ))}
        </select>
        <Button type="submit" loading={pending}>
          {ph("Save contact")}
        </Button>
      </form>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void submit({ url: "/api/v1/crm/segments", body: { name: form.get("segmentName") } });
        }}
      >
        <Input name="segmentName" required placeholder={ph("Segment name")} aria-label={ph("Segment name")} />
        <Button type="submit" variant="secondary" loading={pending}>
          {ph("Save segment")}
        </Button>
      </form>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void submit({
            url: "/api/v1/crm/activities",
            body: {
              contactId: form.get("contactId"),
              businessDate: form.get("businessDate"),
              note: form.get("note"),
            },
          });
        }}
      >
        <select name="contactId" required aria-label={ph("Contact")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
          <option value="">{ph("Contact")}</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.label}
            </option>
          ))}
        </select>
        <Input name="businessDate" type="date" required aria-label={ph("Follow-up date")} />
        <Input name="note" required placeholder={ph("Follow-up note")} aria-label={ph("Follow-up note")} />
        <Button type="submit" variant="secondary" loading={pending}>
          {ph("Save follow-up")}
        </Button>
      </form>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void submit({
            url: "/api/v1/crm/assignments",
            body: {
              contactId: form.get("assignContactId"),
              userId: form.get("userId"),
            },
          });
        }}
      >
        <select name="assignContactId" required aria-label={ph("Assign contact")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
          <option value="">{ph("Contact")}</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.label}
            </option>
          ))}
        </select>
        <select name="userId" required aria-label={ph("User")} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
          <option value="">{ph("User")}</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" loading={pending}>
          {ph("Assign")}
        </Button>
      </form>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </div>
  );
}
