"use client";

import { Button } from "@/components/ui/button";
import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

type Ticket = { id: string; createdOn: string; customerName: string; lines: number; previewTotal: string };

export function TicketList({ tickets, canDiscard }: { tickets: Ticket[]; canDiscard: boolean }) {
  const { submit, pending, message } = useSubmit();
  const { t, date, count, taka } = useI18n();

  return (
    <div className="space-y-3">
      {tickets.map((ticket) => (
        <article key={ticket.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
          <p className="text-sm">{t("sales.ticketLine", { date: date(ticket.createdOn), customer: ticket.customerName, lines: count(ticket.lines), total: taka(ticket.previewTotal) })}</p>
          <div className="flex gap-2">
            <Button href={`/pos?ticket=${ticket.id}`}>{t("sales.ticketResume")}</Button>
            {canDiscard ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  void submit({ url: `/api/v1/pos/tickets/${ticket.id}`, method: "DELETE" }, { successMessage: t("sales.ticketDiscarded") });
                }}
              >
                {t("sales.ticketDiscard")}
              </Button>
            ) : null}
          </div>
        </article>
      ))}
      {message ? <p className="text-sm text-error">{message}</p> : null}
    </div>
  );
}
