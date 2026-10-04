"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type Ticket = { id: string; createdOn: string; customerName: string; lines: number; previewTotal: string };

export function TicketList({ tickets, canDiscard }: { tickets: Ticket[]; canDiscard: boolean }) {
  const [message, setMessage] = useState("");

  return (
    <div className="space-y-3">
      {tickets.map((ticket) => (
        <article key={ticket.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
          <p className="text-sm">
            {ticket.createdOn} · {ticket.customerName} · {ticket.lines} lines · preview {ticket.previewTotal}
          </p>
          {canDiscard ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setMessage("");
              void fetch(`/api/v1/pos/tickets/${ticket.id}`, { method: "DELETE" }).then(async (response) => {
                if (!response.ok) {
                  setMessage("The ticket was not discarded.");
                  return;
                }
                window.location.reload();
              });
            }}
          >
            Discard
          </Button>
          ) : null}
        </article>
      ))}
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </div>
  );
}
