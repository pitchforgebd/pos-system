export function SmsMetrics({
  figures,
}: {
  figures: {
    sentToday: number;
    sentMonth: number;
    sentYear: number;
    sentTotal: number;
  };
}) {
  const rows = [
    ["Sent today", String(figures.sentToday)],
    ["Sent this month", String(figures.sentMonth)],
    ["Sent this year", String(figures.sentYear)],
    ["Total sent", String(figures.sentTotal)],
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
