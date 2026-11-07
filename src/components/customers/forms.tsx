"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export function CustomerForm({ types }: { types: Option[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void postJson("/api/v1/customers", {
          name: form.get("name"),
          phone: String(form.get("phone") || "") || null,
          email: String(form.get("email") || "") || null,
          address: String(form.get("address") || "") || null,
          customerTypeId: String(form.get("customerTypeId") || "") || null,
          openingBalance: form.get("openingBalance") || "0.00",
          creditLimit: String(form.get("creditLimit") || "") || null,
          paymentTerms: String(form.get("paymentTerms") || "") || null,
        })
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The customer was not saved.");
              return;
            }
            window.location.replace("/customers");
          })
          .finally(() => setPending(false));
      }}
    >
      <Input name="name" required placeholder="Name" aria-label="Name" />
      <Input name="phone" placeholder="Phone" aria-label="Phone" />
      <Input name="email" type="email" placeholder="Email" aria-label="Email" />
      <select name="customerTypeId" aria-label="Customer type" className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">No type</option>
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.label}
          </option>
        ))}
      </select>
      <Input name="address" placeholder="Address" aria-label="Address" />
      <Input name="openingBalance" placeholder="Opening balance" aria-label="Opening balance" defaultValue="0.00" />
      <Input name="creditLimit" placeholder="Credit limit" aria-label="Credit limit" />
      <Input name="paymentTerms" placeholder="Payment terms" aria-label="Payment terms" />
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save customer
      </Button>
    </form>
  );
}

export function CustomerEditForm({
  customer,
  types,
}: {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    customerTypeId: string | null;
    creditLimit: string | null;
    paymentTerms: string | null;
    status: "ACTIVE" | "INACTIVE";
    openingBalance: string;
  };
  types: Option[];
}) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void fetch(`/api/v1/customers/${customer.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.get("name"),
            phone: String(form.get("phone") || "") || null,
            email: String(form.get("email") || "") || null,
            address: String(form.get("address") || "") || null,
            customerTypeId: String(form.get("customerTypeId") || "") || null,
            creditLimit: String(form.get("creditLimit") || "") || null,
            paymentTerms: String(form.get("paymentTerms") || "") || null,
            status: form.get("status"),
          }),
        })
          .then(async (response) => {
            const payload = (await response.json()) as { error?: { message?: string } };
            if (!response.ok) {
              setMessage(payload.error?.message ?? "The customer was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
      }}
    >
      <Input name="name" required defaultValue={customer.name} aria-label="Name" />
      <Input name="phone" defaultValue={customer.phone ?? ""} aria-label="Phone" />
      <Input name="email" type="email" defaultValue={customer.email ?? ""} aria-label="Email" />
      <select name="customerTypeId" aria-label="Customer type" defaultValue={customer.customerTypeId ?? ""} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="">No type</option>
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.label}
          </option>
        ))}
      </select>
      <Input name="address" defaultValue={customer.address ?? ""} aria-label="Address" />
      <p className="text-sm text-muted">Opening balance {customer.openingBalance} is not edited.</p>
      <Input name="creditLimit" defaultValue={customer.creditLimit ?? ""} aria-label="Credit limit" />
      <Input name="paymentTerms" defaultValue={customer.paymentTerms ?? ""} aria-label="Payment terms" />
      <select name="status" aria-label="Status" defaultValue={customer.status} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
      </select>
      {message ? <p className="text-sm text-error">{message}</p> : null}
      <Button type="submit" loading={pending}>
        Save profile
      </Button>
    </form>
  );
}

export function TypeForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void postJson("/api/v1/customer-types", { name: form.get("name") })
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The type was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
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
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void postJson(
          url,
          {
            customerId: form.get("customerId"),
            businessDate: form.get("businessDate"),
            amount: form.get("amount"),
            method: form.get("method"),
          },
          true,
        )
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The amount was not posted.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
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
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const visible = invoices.filter((invoice) => invoice.customerId === customerId);
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void postJson("/api/v1/installments", {
          customerId: form.get("customerId"),
          invoiceId: form.get("invoiceId"),
          amount: form.get("amount"),
          dueOn: form.get("dueOn"),
          interestPercent: String(form.get("interestPercent") || "") || undefined,
        })
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The reminder was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
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
  const [message, setMessage] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setMessage("");
        void fetch(`/api/v1/installments/${id}/close`, { method: "POST" })
          .then(async (response) => {
            const payload = (await response.json()) as { error?: { message?: string } };
            if (!response.ok) {
              setMessage(payload.error?.message ?? "The reminder was not closed.");
              return;
            }
            window.location.reload();
          });
      }}
    >
      <Button type="submit" variant="secondary" size="sm">
        Close reminder
      </Button>
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </form>
  );
}

export function TierForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void postJson("/api/v1/loyalty/tiers", {
          name: form.get("name"),
          minimumSpend: form.get("minimumSpend"),
          discountPercent: form.get("discountPercent"),
          benefits: String(form.get("benefits") || "") || null,
        })
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The tier was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
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
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        void postJson("/api/v1/loyalty/cards", {
          customerId: form.get("customerId"),
          tierId: String(form.get("tierId") || "") || null,
          number: form.get("number"),
          cardType: form.get("cardType"),
          issuedOn: form.get("issuedOn"),
          expiresOn: String(form.get("expiresOn") || "") || null,
        })
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The card was not saved.");
              return;
            }
            window.location.reload();
          })
          .finally(() => setPending(false));
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
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setPending(true);
          setMessage("");
          void postJson("/api/v1/crm/contacts", {
            name: form.get("name"),
            phone: String(form.get("phone") || "") || null,
            segmentId: String(form.get("segmentId") || "") || null,
          })
            .then((result) => {
              if (!result.ok) {
                setMessage(result.message || "The contact was not saved.");
                return;
              }
              window.location.reload();
            })
            .finally(() => setPending(false));
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
          setPending(true);
          void postJson("/api/v1/crm/segments", { name: form.get("segmentName") }).then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The segment was not saved.");
              setPending(false);
              return;
            }
            window.location.reload();
          });
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
          setPending(true);
          void postJson("/api/v1/crm/activities", {
            contactId: form.get("contactId"),
            businessDate: form.get("businessDate"),
            note: form.get("note"),
          }).then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The follow-up was not saved.");
              setPending(false);
              return;
            }
            window.location.reload();
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
          setPending(true);
          void postJson("/api/v1/crm/assignments", {
            contactId: form.get("assignContactId"),
            userId: form.get("userId"),
          }).then((result) => {
            if (!result.ok) {
              setMessage(result.message || "The assignment was not saved.");
              setPending(false);
              return;
            }
            window.location.reload();
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
