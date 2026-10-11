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
  const stale = lastOkAt !== null && nowLocal - lastOkAt > STALE_MS;
  const state = error ? "down" : stale ? "stale" : lastOkAt ? "ok" : "idle";
  const dot = { ok: "bg-emerald-500", stale: "bg-amber-500", down: "bg-red-500", idle: "bg-slate-300" }[state];
  const note = { ok: "갱신", stale: "갱신 지연", down: "연결 끊김", idle: "" }[state];

  return (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      <time className="font-mono text-sm font-semibold tabular-nums text-slate-900" suppressHydrationWarning>
        {kst(nowLocal + offsetMs, true)} KST
      </time>
      {state !== "idle" && (
        <span className={`flex items-center gap-1.5 ${state === "down" ? "text-red-600" : state === "stale" ? "text-amber-600" : ""}`}>
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          {note} {lastOkAt && <span className="tabular-nums">{kst(Math.min(lastOkAt, nowLocal) + offsetMs, false)}</span>}
        </span>
      )}
    </div>
  );
}
