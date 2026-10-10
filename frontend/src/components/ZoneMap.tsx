"use client";
import type { RobotView, Tag, Zone, ZoneView } from "@/lib/types";

// 바닥 4×3m 평면도 (100px = 1m). 3D 뷰어가 붙기 전까지 쓰는 2D 대체 화면.
const S = 100;

const FILL = {
  alert: { fill: "#fee2e2", stroke: "#dc2626" },
  working: { fill: "#dbeafe", stroke: "#2563eb" },
  planned: { fill: "#eff6ff", stroke: "#93c5fd" },
  ended: { fill: "#f1f5f9", stroke: "#94a3b8" },
  none: { fill: "#f8fafc", stroke: "#cbd5e1" },
};

interface Props {
  zones: (Zone | ZoneView)[];
  tags?: Tag[];
  robot?: RobotView | null;
  path?: [number, number][] | null;
  highlightZoneId?: string | null;
  pick?: { x: number; y: number } | null;
  onPick?: (x: number, y: number) => void;
}

export function ZoneMap({ zones, tags = [], robot, path, highlightZoneId, pick, onPick }: Props) {
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 4;
    const y = ((e.clientY - r.top) / r.height) * 3;
    onPick(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  };

  return (
    <svg
      viewBox="0 0 400 300"
      className={`w-full rounded-lg border border-slate-200 bg-white ${onPick ? "cursor-crosshair" : ""}`}
      onClick={handleClick}
      role="img"
      aria-label="현장 평면도"
    >
      {zones.map((z) => {
        const v = z as ZoneView;
        const key = v.alert ? "alert" : (v.workState ?? "none");
        const c = FILL[key];
        const [x, y, w, h] = z.rect;
        const hl = highlightZoneId === z.id;
        return (
          <g key={z.id}>
            <rect
              x={x * S + 2}
              y={y * S + 2}
              width={w * S - 4}
              height={h * S - 4}
              rx={6}
              fill={c.fill}
              stroke={hl ? "#0f172a" : c.stroke}
              strokeWidth={hl || v.alert ? 3 : 1.5}
              strokeDasharray={key === "none" || key === "ended" ? "6 4" : undefined}
              className={v.alert ? "animate-pulse" : undefined}
            />
            <text x={x * S + 10} y={y * S + 22} fontSize={13} fontWeight={600} fill="#334155">
              {z.name}
            </text>
          </g>
        );
      })}
      {/* 로봇 대기 위치 */}
      <rect x={3.3 * S - 14} y={2.4 * S - 14} width={28} height={28} rx={4} fill="none" stroke="#94a3b8" strokeDasharray="3 3" />
      <text x={3.3 * S} y={2.4 * S + 30} fontSize={10} textAnchor="middle" fill="#94a3b8">
        로봇 대기
      </text>
      {path && path.length > 1 && (
        <polyline points={path.map(([px, py]) => `${px * S},${py * S}`).join(" ")} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="5 4" />
      )}
      {tags.map((t) => (
        <g key={t.id}>
          <circle cx={t.x * S} cy={t.y * S} r={7} fill={t.official ? "#dc2626" : "#f59e0b"} stroke="#fff" strokeWidth={2} />
          <text x={t.x * S + 10} y={t.y * S + 4} fontSize={10} fill="#0f172a">
            {t.title}
          </text>
        </g>
      ))}
      {pick && <circle cx={pick.x * S} cy={pick.y * S} r={8} fill="none" stroke="#2563eb" strokeWidth={3} />}
      {robot && (
        <g>
          <circle cx={robot.x * S} cy={robot.y * S} r={10} fill="#f97316" stroke="#fff" strokeWidth={3} />
          <text x={robot.x * S} y={robot.y * S + 4} fontSize={10} textAnchor="middle" fill="#fff" fontWeight={700}>
            R
          </text>
        </g>
      )}
    </svg>
  );
}
