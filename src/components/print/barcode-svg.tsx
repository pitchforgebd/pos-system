import { barcodeBars } from "@/modules/catalog/barcode-art";

/**
 * A barcode drawn as bars (an EAN-13 when the code is one, else Code 39), with its number under it. A code no symbology here can draw
 * is printed as its number alone. `height` is the bar height in modules of width.
 */
export function BarcodeSvg({ code, height = 28, className }: { code: string; height?: number; className?: string }) {
  const bars = barcodeBars(code);
  if (!bars) {
    return <p className={className ?? "font-mono text-sm"}>{code}</p>;
  }
  const quiet = 9;
  const width = bars.modules.length + quiet * 2;
  const runs: Array<{ x: number; w: number }> = [];
  let start = -1;
  for (let index = 0; index <= bars.modules.length; index += 1) {
    const bar = index < bars.modules.length && bars.modules[index] === "1";
    if (bar && start < 0) {
      start = index;
    } else if (!bar && start >= 0) {
      runs.push({ x: start + quiet, w: index - start });
      start = -1;
    }
  }
  return (
    <svg viewBox={`0 0 ${width} ${height + 12}`} role="img" aria-label={`Barcode ${code}`} className={className ?? "h-auto w-full"} preserveAspectRatio="xMidYMid meet">
      {runs.map((run) => (
        <rect key={run.x} x={run.x} y={0} width={run.w} height={height} fill="#000" />
      ))}
      <text x={width / 2} y={height + 9} textAnchor="middle" fontSize="8" fontFamily="monospace">
        {code}
      </text>
    </svg>
  );
}
