"use client";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ZoneMap } from "@/components/ZoneMap";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { EVENT_LABEL, fmtTime, isOpen, robotSummary, SOURCE_LABEL, workWarnings } from "@/lib/format";
import type { Alert, DrawingsResponse, StateResponse } from "@/lib/types";

export default function ControlPage() {
  const { data, error, refresh } = usePolling<StateResponse>("/state", 500);
  const { data: dwg } = usePolling<DrawingsResponse>("/drawings", 10000);

  const post = async (path: string, body?: unknown) => {
    await api.post(path, body).catch((e) => window.alert(e instanceof Error ? e.message : "실패"));
    refresh();
  };

  const openAll = data?.alerts.filter((a) => a.status !== "resolved") ?? [];
  const open = openAll.filter((a) => a.type === "fall"); // 쓰러짐 (로봇 출동 대상)
  const abnormals = openAll.filter((a) => a.type === "abnormal"); // 측정 이상 (출동 없음)
  const focus = open[0] ?? null;
  const robotState = data ? `${robotSummary(data.robot)} · ${data.robot.battery}%` : "-";

  return (
    <AppShell title="관제">
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section className="space-y-3">
          {focus && <AlertBanner a={focus} zoneName={data?.zones.find((z) => z.id === focus.zoneId)?.name} onAck={() => post("/alert/ack", { alertId: focus.id })} onHuman={() => post("/alert/human", { alertId: focus.id })} onResolve={(r) => post("/alert/resolve", { alertId: focus.id, resolution: r })} />}
          {abnormals.map((a) => (
            <AbnormalBanner key={a.id} a={a} zoneName={data?.zones.find((z) => z.id === a.zoneId)?.name} onAck={() => post("/alert/ack", { alertId: a.id })} onResolve={() => post("/alert/resolve", { alertId: a.id, resolution: "handled" })} />
          ))}
          <div className="card space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <h2 className="font-bold">현장</h2>
              <Legend />
              <span className="ml-auto rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">로봇 · {robotState}</span>
            </div>
            {data ? (
              <ZoneMap zones={data.zones} tags={data.tags} robot={data.robot} path={data.dispatch?.status === "moving" ? data.dispatch.path : null} highlightZoneId={focus?.zoneId ?? abnormals[0]?.zoneId} />
            ) : (
              <p className="py-20 text-center text-slate-500">{error ?? "불러오는 중…"}</p>
            )}
          </div>
          {focus?.zoneId && (
            <div className="card text-sm">
              <h3 className="mb-1 font-bold text-red-700">{focus.zoneId} 위험 정보 (구조자 전달용)</h3>
              {data?.tags
                .filter((t) => t.zoneId === focus.zoneId)
                .map((t) => (
                  <p key={t.id}>
                    <b>{t.title}</b> {t.substance && `(${t.substance})`} — {t.hazard}
                    {t.emergencyNote && <span className="text-red-700"> · {t.emergencyNote}</span>}
                  </p>
                ))}
              <div className="mt-2 flex flex-wrap gap-1">
                {dwg?.drawings
                  .filter((d) => d.zoneIds.includes(focus.zoneId!) && !d.cad)
                  .map((d) => (
                    <a key={d.id} href={`/drawing?id=${d.id}`} target="_blank" className="rounded-full border border-slate-300 px-2 py-0.5 text-xs">
                      📐 {d.title}
                    </a>
                  ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <div className="card">
            <h2 className="mb-2 font-bold">진행 중인 작업</h2>
            <ul className="space-y-1 text-sm">
              {data?.works
                .filter(isOpen)
                .map((w) => (
                  <li key={w.id}>
                    <Link href={`/admin/works/${w.id}`} className="-mx-2 flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                      <span className="font-mono text-xs">{w.code}</span>
                      <span className="truncate">{w.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-slate-500">
                        {w.zoneId} · {w.checkedInAt ? (w.status === "confirmed" ? "작업 중" : "확인 중") : "체크인 전"} · {w.done}/{w.total}
                      </span>
                    </Link>
                    {workWarnings(w, data.now).map((x) => (
                      <div key={x.kind} className="text-right text-xs font-semibold text-amber-700">
                        ⚠ {x.text}
                      </div>
                    ))}
                  </li>
                ))}
            </ul>
          </div>

          <div className="card">
            <h2 className="mb-2 font-bold">직접 출동</h2>
            <div className="flex gap-2">
              {data?.zones.map((z) => (
                <button key={z.id} className="btn-ghost flex-1" disabled={open.length > 0 || !data?.robot.available} onClick={() => window.confirm(`${z.name} 로 로봇을 보낼까요?`) && post("/event", { source: "operator", zoneId: z.id })}>
                  {z.id}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="mb-2 flex items-center"><h2 className="font-bold">오늘 타임라인</h2><Link href="/history" className="ml-auto text-xs text-blue-600">전체 이력 →</Link></div>
            <ol className="max-h-80 space-y-1 overflow-y-auto text-xs">
              {data?.events.map((e) => (
                <li key={e.seq} className="flex gap-2">
                  <span className="shrink-0 font-mono text-slate-400">{fmtTime(e.at)}</span>
                  <span className="shrink-0 font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span>
                  <span className="text-slate-600">{e.text}</span>
                </li>
              ))}
            </ol>
          </div>

        </aside>
      </div>
    </AppShell>
  );
}

function AlertBanner({ a, zoneName, onAck, onHuman, onResolve }: { a: Alert; zoneName?: string; onAck: () => void; onHuman: () => void; onResolve: (r: "handled" | "false_alarm") => void }) {
  const noRobot = a.status === "no_robot";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-red-600 p-4 text-white shadow">
      <div>
        <div className="text-xs opacity-80">
          A-{a.id} · {SOURCE_LABEL[a.source]} · {fmtTime(a.raisedAt)} · {a.deviceId ?? "기기 없음"}
        </div>
        <div className="text-xl font-bold">쓰러짐 · {zoneName ?? "구역 불명"}</div>
        <div className="text-xs opacity-90">
          {noRobot ? (
            <span className="rounded bg-white/20 px-1.5 py-0.5 font-semibold">
              로봇 출동 불가 · {a.robotUnavailable} — {a.humanDispatchedAt ? `안전관리자 출동 ${fmtTime(a.humanDispatchedAt)}` : "사람을 보내 주세요"}
            </span>
          ) : (
            "로봇 자동 출동됨"
          )}
        </div>
      </div>
      <div className="ml-auto flex gap-2">
        {noRobot && !a.humanDispatchedAt && (
          <button className="btn animate-pulse bg-amber-300 text-slate-900" onClick={onHuman}>
            안전관리자 출동 지시
          </button>
        )}
        {a.acknowledgedAt ? (
          <span className="rounded-lg bg-white/20 px-3 py-2 text-sm">확인 {fmtTime(a.acknowledgedAt)}</span>
        ) : (
          <button className="btn bg-white text-red-700" onClick={onAck}>
            확인했어요
          </button>
        )}
        <button className="btn bg-red-800 text-white" onClick={() => onResolve("handled")}>
          처리 완료
        </button>
        <button className="btn bg-red-800 text-white" onClick={() => onResolve("false_alarm")}>
          오탐 해제
        </button>
      </div>
    </div>
  );
}

function AbnormalBanner({ a, zoneName, onAck, onResolve }: { a: Alert; zoneName?: string; onAck: () => void; onResolve: () => void }) {
  const r = a.reading;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div>
        <div className="text-xs opacity-80">
          A-{a.id} · 측정 이상 · {fmtTime(a.raisedAt)} · {a.deviceId}
        </div>
        <div className="text-lg font-bold">
          {zoneName ?? a.zoneId} · {r?.tagTitle} {r?.item}
        </div>
        <div className="text-sm">
          측정값 <b>{r?.value}{r?.unit}</b> · 정상 {r?.range}
          {r?.recheckedAt && <span className="ml-2 text-emerald-700">→ 재측정 {r.recheckedValue}{r.unit} 정상 ({fmtTime(r.recheckedAt)})</span>}
        </div>
        <div className="text-xs opacity-80">로봇 출동 없음 · 작업 시작은 막혀 있어요 (정상값이 확인될 때까지)</div>
      </div>
      <div className="ml-auto flex gap-2">
        {a.acknowledgedAt ? (
          <span className="rounded-lg bg-amber-100 px-3 py-2 text-sm">확인 {fmtTime(a.acknowledgedAt)}</span>
        ) : (
          <button className="btn bg-amber-500 text-white" onClick={onAck}>
            확인했어요
          </button>
        )}
        <button className="btn-ghost" onClick={onResolve}>
          처리 완료
        </button>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ["#dc2626", "쓰러짐"],
    ["#d97706", "측정 이상"],
    ["#2563eb", "작업 중"],
    ["#93c5fd", "예정"],
    ["#cbd5e1", "없음"],
  ];
  return (
    <span className="flex gap-2 text-xs text-slate-500">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
          {l}
        </span>
      ))}
    </span>
  );
}
