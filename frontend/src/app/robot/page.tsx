"use client";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ZoneMap } from "@/components/ZoneMap";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { EVENT_LABEL, fmtShort, ROBOT_MODE_LABEL, robotSummary } from "@/lib/format";
import type { HistoryResponse, RobotMode, StateResponse } from "@/lib/types";

const MODES: RobotMode[] = ["ready", "charging", "maintenance", "offline"];

// 로봇: 지금 출동할 수 있는지, 배터리, 출동 기록. 출동할 수 없으면 알림은 '사람 출동 필요'로 넘어간다
export default function RobotPage() {
  const { data, refresh } = usePolling<StateResponse>("/state", 1000);
  const { data: hist } = usePolling<HistoryResponse>("/history?day=all&cat=robot", 3000);
  const r = data?.robot;
  const events = hist?.events ?? [];
  const trips = events.filter((e) => e.type === "dispatch.arrived").length;
  const unavailable = events.filter((e) => e.type === "dispatch.unavailable").length;

  const setMode = async (mode: RobotMode) => {
    await api.post("/robot/mode", { mode });
    refresh();
  };

  return (
    <AppShell title="로봇" fill>
      <div className="grid gap-4 lg:h-full lg:grid-cols-[420px_1fr]">
        {/* 왼쪽: 상태 → 출동 기록(그 안에서 스크롤) · 오른쪽: 지도(화면 높이에 맞춤) */}
        <div className="space-y-4 lg:flex lg:min-h-0 lg:flex-col lg:gap-4 lg:space-y-0">
          <section className="card shrink-0 space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="font-bold">순찰 로봇 R-01</h2>
              {r && (
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${r.available ? "bg-emerald-50 text-emerald-700" : r.state === "moving" ? "bg-orange-50 text-orange-700" : "bg-red-50 text-red-700"}`}
                >
                  {robotSummary(r)}
                </span>
              )}
            </div>
            {r && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">배터리</span>
                  <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                    <div
                      className={`h-2.5 rounded-full ${r.battery < 20 ? "bg-red-500" : r.battery < 50 ? "bg-amber-400" : "bg-emerald-500"}`}
                      style={{ width: `${r.battery}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs">{r.battery}%</span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <Stat k="현재 위치" v={`${r.x.toFixed(1)}, ${r.y.toFixed(1)} m`} />
                  <Stat k="이동 속도" v="0.45 m/s" />
                  <Stat k="출동 완료" v={`${trips}회`} />
                  <Stat k="출동 불가" v={`${unavailable}회`} warn={unavailable > 0} />
                </dl>
                <div>
                  <div className="label">운영 상태</div>
                  <div className="grid grid-cols-4 gap-1">
                    {MODES.map((m) => (
                      <button key={m} onClick={() => setMode(m)} className={`btn px-1 text-xs ${r.mode === m ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}>
                        {ROBOT_MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  출동 대기가 아닐 때 쓰러짐 알림이 오면 관제에 <b>“로봇 출동 불가 — 사람 출동 필요”</b>로 떠요. 관제가 안전관리자 출동을 지시하면 그 시각이 기록돼요.
                </p>
              </>
            )}
          </section>

          <section className="card lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <div className="mb-2 flex items-center">
              <h2 className="font-bold">출동 기록</h2>
              <Link href="/history?day=all&cat=robot" className="ml-auto text-xs text-blue-600">
                이력에서 보기 →
              </Link>
            </div>
            <ol className="max-h-96 space-y-1 overflow-y-auto text-sm lg:max-h-none lg:min-h-0 lg:flex-1">
              {events.slice(0, 50).map((e) => (
                <li key={e.seq} className="grid grid-cols-[5.5rem_6.5rem_1fr] gap-2">
                  <span className="font-mono text-xs leading-5 text-slate-400">{fmtShort(e.at)}</span>
                  <span className="font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span>
                  <span className="text-slate-600">{e.text}</span>
                </li>
              ))}
              {events.length === 0 && <li className="text-slate-400">기록이 없어요</li>}
            </ol>
          </section>
        </div>

        <section className="card space-y-2 lg:flex lg:min-h-0 lg:flex-col lg:space-y-0 lg:gap-2">
          <h2 className="font-bold">현재 위치</h2>
          <div className="lg:min-h-0 lg:flex-1">
            {data && <ZoneMap fit zones={data.zones} robot={data.robot} path={data.dispatch?.status === "moving" ? data.dispatch.path : null} />}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ k, v, warn = false }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className={`font-semibold ${warn ? "text-amber-700" : ""}`}>{v}</dd>
    </div>
  );
}
