"use client";
import type { GatewayView, Presence, RobotView, Tag, Zone, ZoneView } from "@/lib/types";

// 바닥 4×3m 평면도 (100px = 1m). 3D 뷰어가 붙기 전까지 쓰는 2D 대체 화면.
const S = 100;

const FILL = {
  alert: { fill: "#fee2e2", stroke: "#dc2626" },
  warning: { fill: "#fef3c7", stroke: "#d97706" },
  working: { fill: "#dbeafe", stroke: "#2563eb" },
  planned: { fill: "#eff6ff", stroke: "#93c5fd" },
  ended: { fill: "#f1f5f9", stroke: "#94a3b8" },
  none: { fill: "#f8fafc", stroke: "#cbd5e1" },
};

// 헬멧 색 (단말 순서대로). 구역 색(빨강 · 주황 · 파랑)과 겹치지 않게
export const HELMET_COLORS = ["#0891b2", "#7c3aed", "#db2777", "#65a30d"];

interface Props {
  zones: (Zone | ZoneView)[];
  tags?: Tag[];
  robot?: RobotView | null;
  path?: [number, number][] | null;
  highlightZoneId?: string | null;
  pick?: { x: number; y: number } | null;
  onPick?: (x: number, y: number) => void;
  onTagClick?: (tagId: number) => void;
  selectedTagId?: number | null;
  // 헬멧 비콘 (백엔드만): 위치가 있으면 점 + 오차 원, 위치 없이 구역 안이면 그 구역에 이름표
  helmets?: Presence[];
  receivers?: GatewayView[];
  selectedReceiverId?: string | null; // 수신기 배치 화면: 고른 수신기에 테두리
  // true 면 넓은 화면에서 부모 높이에 맞춰 4:3 비율로 줄어든다 (부모에 높이가 있어야 한다)
  fit?: boolean;
}

// 라벨 너비 대충 계산 (한글은 글자 크기만큼, 영문·숫자는 0.6배)
const textWidth = (s: string, size: number) => [...s].reduce((w, ch) => w + (/[\u3131-\uD79D]/.test(ch) ? size : size * 0.6), 0);

export function ZoneMap({
  zones,
  tags = [],
  robot,
  path,
  highlightZoneId,
  pick,
  onPick,
  onTagClick,
  selectedTagId,
  helmets = [],
  receivers = [],
  selectedReceiverId,
  fit = false,
}: Props) {
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 4;
    const y = ((e.clientY - r.top) / r.height) * 3;
    onPick(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  };

  // 태그가 속한 구역의 오른쪽 끝 (없으면 지도 끝)
  const rightEdge = (t: Tag) => {
    const z = zones.find((zz) => zz.id === t.zoneId);
    return z ? (z.rect[0] + z.rect[2]) * S - 6 : 400 - 6;
  };

  const svg = (
    <svg
      viewBox="0 0 400 300"
      className={`rounded-lg border border-slate-200 bg-white ${fit ? "mx-auto block w-full lg:h-auto lg:w-[min(100cqw,133.33cqh)]" : "w-full"} ${onPick ? "cursor-crosshair" : ""}`}
      onClick={handleClick}
      role="img"
      aria-label="현장 평면도"
    >
      {zones.map((z) => {
        const v = z as ZoneView;
        const key = v.alert ? "alert" : v.warning ? "warning" : (v.workState ?? "none");
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
      {path && path.length > 1 && <polyline points={path.map(([px, py]) => `${px * S},${py * S}`).join(" ")} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="5 4" />}
      {tags.map((t) => {
        const left = t.x * S + 10 + textWidth(t.title, 10) > rightEdge(t); // 구역 밖으로 나가면 왼쪽에
        const sel = selectedTagId === t.id;
        return (
          <g key={t.id} onClick={onTagClick ? (e) => (e.stopPropagation(), onTagClick(t.id)) : undefined} className={onTagClick ? "cursor-pointer" : undefined}>
            {sel && <circle cx={t.x * S} cy={t.y * S} r={13} fill="none" stroke="#2563eb" strokeWidth={3} />}
            <circle cx={t.x * S} cy={t.y * S} r={7} fill={t.official ? "#dc2626" : "#f59e0b"} stroke="#fff" strokeWidth={2} />
            <text
              x={left ? t.x * S - 10 : t.x * S + 10}
              y={t.y * S + 4}
              fontSize={10}
              fontWeight={sel ? 700 : 400}
              textAnchor={left ? "end" : "start"}
              fill={sel ? "#1d4ed8" : "#0f172a"}
            >
              {t.title}
            </text>
          </g>
        );
      })}
      {pick && <circle cx={pick.x * S} cy={pick.y * S} r={8} fill="none" stroke="#2563eb" strokeWidth={3} />}
      {/* 비콘 수신기 (꺼지면 흐리게). 지도 가장자리면 이름을 안쪽으로 */}
      {receivers.map((g) => {
        if (g.x == null || g.y == null) return null;
        const anchor = g.x < 0.5 ? "start" : g.x > 3.5 ? "end" : "middle";
        const lx = g.x * S + (anchor === "start" ? 7 : anchor === "end" ? -7 : 0);
        return (
          <g key={g.id} opacity={g.online || selectedReceiverId === g.id ? 1 : 0.35}>
            {selectedReceiverId === g.id && <rect x={g.x * S - 10} y={g.y * S - 10} width={20} height={20} rx={4} fill="none" stroke="#2563eb" strokeWidth={3} />}
            <rect x={g.x * S - 5} y={g.y * S - 5} width={10} height={10} rx={2} fill="#475569" stroke="#fff" strokeWidth={1.5} />
            <text x={lx} y={g.y * S - 9} fontSize={9} textAnchor={anchor} fill="#475569" stroke="#fff" strokeWidth={3} paintOrder="stroke">
              {g.label}
            </text>
          </g>
        );
      })}
      {/* 헬멧: 위치는 신호 세기로 어림 (±50%) → 오차 원을 함께. 폴링 사이를 부드럽게 옮긴다 */}
      {helmets.map((h, i) => {
        const color = HELMET_COLORS[i % HELMET_COLORS.length];
        if (h.position) {
          const x = Math.min(3.95, Math.max(0.05, h.position.x)) * S; // 지도 밖이면 가장자리에
          const y = Math.min(2.95, Math.max(0.05, h.position.y)) * S;
          return (
            <g key={h.deviceId} style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform 0.5s linear" }}>
              <circle r={Math.max(h.position.err * S, 12)} fill={color} fillOpacity={0.12} stroke={color} strokeOpacity={0.5} strokeDasharray="3 3" />
              <circle r={7} fill={color} stroke="#fff" strokeWidth={2} />
              <text y={-11} fontSize={10} fontWeight={700} textAnchor="middle" fill={color} stroke="#fff" strokeWidth={3} paintOrder="stroke">
                {h.label}
              </text>
            </g>
          );
        }
        const z = h.state === "in" ? zones.find((zz) => zz.id === h.zoneId) : undefined;
        if (!z) return null;
        // 위치는 모르고 구역 안인 것만 안다: 구역 오른쪽 위에 차례로
        const k = helmets.filter((o, j) => j < i && !o.position && o.state === "in" && o.zoneId === h.zoneId).length;
        const tx = (z.rect[0] + z.rect[2]) * S - 14;
        const ty = z.rect[1] * S + 18 + k * 16;
        return (
          <g key={h.deviceId}>
            <circle cx={tx} cy={ty} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />
            <text x={tx - 9} y={ty + 4} fontSize={10} fontWeight={700} textAnchor="end" fill={color} stroke="#fff" strokeWidth={3} paintOrder="stroke">
              {h.label} (구역 안)
            </text>
          </g>
        );
      })}
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

  if (!fit) return svg;
  // 넓은 화면: 이 상자의 크기(cqw·cqh)를 기준으로 지도가 들어갈 만큼만 커진다
  return <div className="lg:h-full lg:min-h-0 lg:[container-type:size]">{svg}</div>;
}
