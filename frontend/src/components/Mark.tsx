// Plan of a five-bastion star fort with the keep in the middle.
function star(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((-90 + (i * 180) / points) * Math.PI) / 180;
    coords.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${coords.join(" L")} Z`;
}

function polygon(cx: number, cy: number, r: number, sides = 5): string {
  const coords: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((-90 + (i * 360) / sides) * Math.PI) / 180;
    coords.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${coords.join(" L")} Z`;
}

const WALL = star(50, 52, 46, 27);
const KEEP = polygon(50, 52, 12);

export type MarkState = "drawing" | "idle" | "busy" | "done";

export function Mark({ state = "idle", className }: { state?: MarkState; className?: string }) {
  return (
    <svg className={`mark ${className ?? ""}`} data-state={state} viewBox="0 0 100 100" aria-hidden="true">
      <path className="mark-wall" d={WALL} pathLength={1} />
      <path className="mark-keep" d={KEEP} pathLength={1} />
    </svg>
  );
}
