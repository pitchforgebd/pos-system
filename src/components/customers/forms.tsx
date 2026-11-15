"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/lib/client/use-submit";

type Option = { id: string; label: string };

export function TypeForm() {
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
      <Input name="name" required placeholder="Type name" aria-label="Type name" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save type
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
      <select name="customerId" required aria-label="Customer" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">Customer</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.label}
          </option>
        ))}
      </select>
      <Input name="businessDate" type="date" required aria-label="Date" />
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <select name="method" required aria-label="Method" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="CASH">Cash</option>
        <option value="BANK">Bank</option>
      </select>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        {title}
      </Button>
    </form>
  );
}

export function PaymentForm({ customers }: { customers: Option[] }) {
  return <MoneyForm title="Collect due" url="/api/v1/customer-payments" customers={customers} />;
}

export function AdvanceForm({ customers }: { customers: Option[] }) {
  return <MoneyForm title="Take advance" url="/api/v1/customer-advances" customers={customers} />;
}

export function InstallmentForm({ customers, invoices }: { customers: Option[]; invoices: Array<Option & { customerId: string | null }> }) {
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
        aria-label="Customer"
        className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
        onChange={(event) => setCustomerId(event.target.value)}
      >
        <option value="">Customer</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.label}
          </option>
        ))}
      </select>
      <select name="invoiceId" required aria-label="Invoice" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">Invoice</option>
        {visible.map((invoice) => (
          <option key={invoice.id} value={invoice.id}>
            {invoice.label}
          </option>
        ))}
      </select>
      <Input name="amount" required placeholder="Amount" aria-label="Amount" />
      <Input name="interestPercent" placeholder="Interest percent, optional" aria-label="Interest percent" />
      <Input name="dueOn" type="date" required aria-label="Due date" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Add reminder
      </Button>
    </form>
  );
}

export function CloseReminder({ id }: { id: string }) {
  const { submit, pending, message } = useSubmit();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ url: `/api/v1/installments/${id}/close` });
      }}
    >
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        Close reminder
      </Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}

export function TierForm() {
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
      <Input name="name" required placeholder="Tier name" aria-label="Tier name" />
      <Input name="minimumSpend" required placeholder="Minimum spend" aria-label="Minimum spend" />
      <Input name="discountPercent" required placeholder="Discount percent" aria-label="Discount percent" />
      <Input name="benefits" placeholder="Benefits" aria-label="Benefits" />
      <p className="text-sm text-muted">The discount percent is stored. Sales do not use it.</p>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save tier
      </Button>
    </form>
  );
}

export function CardForm({ customers, tiers }: { customers: Option[]; tiers: Option[] }) {
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
      <Input name="number" required placeholder="Card number" aria-label="Card number" />
      <Input name="cardType" required placeholder="Card type" aria-label="Card type" />
      <select name="customerId" required aria-label="Customer" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">Customer</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.label}
          </option>
        ))}
      </select>
      <select name="tierId" aria-label="Tier" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">No tier</option>
        {tiers.map((tier) => (
          <option key={tier.id} value={tier.id}>
            {tier.label}
          </option>
        ))}
      </select>
      <Input name="issuedOn" type="date" required aria-label="Issued" />
      <Input name="expiresOn" type="date" aria-label="Expires" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Issue card
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
        <Input name="name" required placeholder="Contact name" aria-label="Contact name" />
        <Input name="phone" placeholder="Phone" aria-label="Phone" />
        <select name="segmentId" aria-label="Segment" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
          <option value="">No segment</option>
          {segments.map((segment) => (
            <option key={segment.id} value={segment.id}>
              {segment.label}
            </option>
          ))}
        </select>
        <Button type="submit" loading={pending}>
          Save contact
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
        <Input name="segmentName" required placeholder="Segment name" aria-label="Segment name" />
        <Button type="submit" variant="secondary" loading={pending}>
          Save segment
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
        <select name="contactId" required aria-label="Contact" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
          <option value="">Contact</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.label}
            </option>
          ))}
        </select>
        <Input name="businessDate" type="date" required aria-label="Follow-up date" />
        <Input name="note" required placeholder="Follow-up note" aria-label="Follow-up note" />
        <Button type="submit" variant="secondary" loading={pending}>
          Save follow-up
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
        <select name="assignContactId" required aria-label="Assign contact" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
          <option value="">Contact</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.label}
            </option>
          ))}
        </select>
        <select name="userId" required aria-label="User" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
          <option value="">User</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" loading={pending}>
          Assign
        </Button>
      </form>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </div>
  );
}
