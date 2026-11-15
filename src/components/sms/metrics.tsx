export function SmsMetrics({
  figures,
}: {
  figures: {
    sentToday: number;
    sentMonth: number;
    sentYear: number;
    sentTotal: number;
    sentParts?: number;
    queued?: number;
    failed?: number;
    balance?: string | null;
    provider?: string | null;
  };
}) {
  const rows = [
    ["Sent today", String(figures.sentToday)],
    ["Sent this month", String(figures.sentMonth)],
    ["Sent this year", String(figures.sentYear)],
    ["Total sent (SMS parts)", `${figures.sentTotal}${figures.sentParts !== undefined ? ` (${figures.sentParts})` : ""}`],
    ["Waiting in the outbox", String(figures.queued ?? 0)],
    ["Failed after all tries", String(figures.failed ?? 0)],
    ["Provider", figures.provider ?? "Not set up: messages wait"],
    ["Left on the SMS account", figures.balance ?? "The provider does not say"],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-md border border-border px-3 py-2">
          <dt className="text-sm text-muted">{label}</dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
