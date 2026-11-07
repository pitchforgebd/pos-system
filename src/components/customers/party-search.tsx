"use client";

import { useMemo, useState } from "react";
import { businessDate } from "@/core/time/business-date";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Party = { id: string; name: string; phone: string | null; outstanding: string };

function today() {
  return businessDate();
}

function hasDue(value: string) {
  return value !== "0.00" && value !== "0" && !value.startsWith("-");
}

export function PartyAmountForm({
  title,
  url,
  parties,
  mode,
  balanceLabel = "Due",
}: {
  title: string;
  url: string | ((id: string) => string);
  parties: Party[];
  mode: "due" | "advance";
  balanceLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Party | null>(null);
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [method, setMethod] = useState("CASH");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return parties.filter((party) => {
      if (mode === "due" && !hasDue(party.outstanding)) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return `${party.name} ${party.phone ?? ""}`.toLowerCase().includes(needle);
    });
  }, [mode, parties, query]);
  const shown = matched.slice(0, 50);
  const active = shown[Math.min(index, Math.max(shown.length - 1, 0))] ?? null;

  function choose(party: Party) {
    setSelected(party);
    setAmount(mode === "due" ? party.outstanding : "");
    setMessage("");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-2xl border border-border bg-surface p-4">
        <label className="grid gap-1 text-sm">
          Name or phone
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((current) => Math.min(current + 1, Math.max(shown.length - 1, 0)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter" && active) {
                event.preventDefault();
                choose(active);
              }
            }}
            placeholder="Search name or phone"
            aria-label="Search name or phone"
            className="h-10 rounded-md border border-border px-3"
          />
        </label>
        <p className="mt-2 text-sm text-muted">
          Showing {shown.length} of {matched.length}. Use the up and down keys, then Enter.
        </p>
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{mode === "due" ? `No outstanding ${balanceLabel.toLowerCase()}.` : "No matching name."}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border" role="listbox" aria-label="Customers">
            {shown.map((party) => {
              const current = party.id === active?.id;
              return (
                <li key={party.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={current}
                    className={`flex w-full items-center justify-between px-2 py-3 text-left text-sm ${current ? "bg-secondary" : "hover:bg-surface-muted"}`}
                    onClick={() => choose(party)}
                  >
                    <span>
                      <span className="block font-medium">{party.name}</span>
                      <span className="text-xs text-muted">{party.phone ?? "No phone"}</span>
                    </span>
                    <span>{party.outstanding}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <form
        className="h-fit rounded-2xl border border-border bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selected) {
            setMessage("Choose a name from the list.");
            return;
          }
          setPending(true);
          setMessage("");
          const target = typeof url === "function" ? url(selected.id) : url;
          const body = typeof url === "function" ? { occurredOn, amount, method } : { customerId: selected.id, occurredOn, amount, method };
          void fetch(target, {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
            body: JSON.stringify(body),
          })
            .then(async (response) => {
              const payload = (await response.json()) as { error?: { message?: string } };
              if (!response.ok) {
                setMessage(payload.error?.message ?? "The amount was not posted.");
                return;
              }
              window.location.reload();
            })
            .finally(() => setPending(false));
        }}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        {selected ? (
          <p className="mt-2 text-sm">
            {selected.name}
            <span className="mt-1 block text-muted">
              {balanceLabel} {selected.outstanding}
            </span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Select a name from the list.</p>
        )}
        <div className="mt-3 grid gap-3">
          <Input type="date" required aria-label="Date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} />
          <Input required aria-label="Amount" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <select aria-label="Method" value={method} onChange={(event) => setMethod(event.target.value)} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
            <option value="CASH">Cash</option>
            <option value="BANK">Bank</option>
          </select>
        </div>
        {message ? <p className="mt-3 text-sm text-error">{message}</p> : null}
        <Button type="submit" className="mt-4 w-full" loading={pending} disabled={!selected}>
          {title}
        </Button>
      </form>
    </div>
  );
}
