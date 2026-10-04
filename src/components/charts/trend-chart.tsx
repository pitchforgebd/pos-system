export function TrendChart({
  points,
  label,
}: {
  points: { label: string; value: number }[];
  label: string;
}) {
  const width = 320;
  const height = 128;
  const max = Math.max(...points.map((point) => point.value), 1);
  const step = points.length > 1 ? width / (points.length - 1) : width;

  const coordinates = points
    .map((point, index) => {
      const x = index * step;
      const y = height - (point.value / max) * (height - 16) - 8;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-36 w-full text-primary">
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={coordinates} />
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        {points.map((point) => (
          <span key={point.label}>{point.label.slice(0, 6)}</span>
        ))}
      </div>
    </div>
  );
}

export function DistributionBars({
  items,
}: {
  items: { label: string; percent: number }[];
}) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span>{item.label}</span>
            <span className="tabular-nums text-muted">{item.percent}%</span>
          </div>
          <div className="h-2 bg-secondary" role="presentation">
            <div className="h-2 bg-primary" style={{ width: `${item.percent}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
