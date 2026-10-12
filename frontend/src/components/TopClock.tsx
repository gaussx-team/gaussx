"use client";
import { useSecondTick, useServerSync } from "@/lib/serverClock";

// 상단 바: 서버 기준 현재 시각(KST) + 마지막 갱신 시각. 갱신이 멈추면 색으로 알린다.
const STALE_MS = 25_000; // 가장 느린 폴링(10초)의 2배 이상

const kst = (ms: number, withDate: boolean) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    ...(withDate ? { month: "2-digit", day: "2-digit", weekday: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(ms);

export function TopClock() {
  const tick = useSecondTick();
  const { offsetMs, lastOkAt, error } = useServerSync();

  if (tick === null) return <div className="h-5 w-56" aria-hidden />;

  const nowLocal = tick * 1000;
  const fresh = lastOkAt !== null && nowLocal - lastOkAt <= STALE_MS;
  // ok: 정상 · partial: 일부 API 만 실패 · stale: 실패는 없는데 갱신이 멈춤 · down: 실패 + 갱신 멈춤(또는 한 번도 못 받음)
  const state = error ? (fresh ? "partial" : "down") : lastOkAt === null ? "idle" : fresh ? "ok" : "stale";
  const view = {
    ok: { dot: "bg-emerald-500", text: "", note: "갱신" },
    partial: { dot: "bg-red-500", text: "text-red-600", note: "일부 정보 못 받음 · 갱신" },
    stale: { dot: "bg-amber-500", text: "text-amber-600", note: "갱신 지연 · 마지막" },
    down: { dot: "bg-red-500", text: "text-red-600", note: lastOkAt ? "연결 끊김 · 마지막" : "연결 끊김" },
    idle: null,
  }[state];

  return (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      <time className="font-mono text-sm font-semibold tabular-nums text-slate-900" suppressHydrationWarning>
        {kst(nowLocal + offsetMs, true)} KST
      </time>
      {view && (
        <span className={`flex items-center gap-1.5 ${view.text}`} title={error ?? undefined} role="status">
          <span className={`h-2 w-2 rounded-full ${view.dot}`} />
          {view.note} {lastOkAt && <span className="tabular-nums">{kst(Math.min(lastOkAt, nowLocal) + offsetMs, false)}</span>}
        </span>
      )}
    </div>
  );
}
