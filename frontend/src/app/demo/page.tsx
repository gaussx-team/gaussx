"use client";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { useState } from "react";
import { PhoneFrame } from "@/components/PhoneFrame";
import { ZoneMap } from "@/components/ZoneMap";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { fmtTime, ROBOT_MODE_LABEL, robotSummary } from "@/lib/format";
import type { RobotMode, StateResponse } from "@/lib/types";

const DEVICE = "device-01";

// 발표자 전용 시연 모드: 작업자 휴대폰 화면 + 시나리오 진행 + 무대 트리거를 한 화면에
export default function DemoPage() {
  const { data, refresh } = usePolling<StateResponse>("/state", 500);
  const [frameKey, setFrameKey] = useState(0);

  const work = data?.works.findLast((w) => w.deviceId === DEVICE) ?? null;
  const alert = work ? (data?.alerts.find((a) => a.type === "fall" && a.workId === work.id) ?? null) : null;
  const openAlert = data?.alerts.find((a) => a.type === "fall" && a.status !== "resolved") ?? null;

  const steps = [
    { who: "원청 담당자", what: "작업 등록 · 전송", say: "구역을 고르면 그 구역 위험 태그가 자동으로 묶여 작업반장 단말로 가요.", at: work?.publishedAt },
    { who: "작업반장", what: "카드 열람", say: "로그인 없이 기기로 받아요. 열람 시각이 남아요.", at: work?.openedAt },
    { who: "작업반장", what: "작업 전 확인 · 체크인", say: "첫 확인이 곧 체크인. 잔압에 3을 넣으면 거부되고 관제에 '측정 이상'이 떠요 → 0으로 다시 측정.", at: work?.checkedInAt },
    { who: "작업반장", what: "확인 완료 · 작업 시작", say: "필수 항목을 다 해야 버튼이 열려요. 체크는 되돌릴 수 없어요.", at: work?.confirmedAt },
    { who: "현장", what: "쓰러짐 발생", say: "자동 감지 · SOS 3초 · 무대 트리거 중 하나.", at: alert?.raisedAt },
    alert?.status === "no_robot" || alert?.robotUnavailable
      ? { who: "관제", what: "로봇 출동 불가 → 사람 출동", say: `로봇이 ${alert.robotUnavailable}이라 못 가요. 관제가 안전관리자를 보내고 그 시각이 남아요.`, at: alert.humanDispatchedAt }
      : { who: "로봇", what: "자동 출동 · 도착", say: "관제 확인을 기다리지 않고 알림과 동시에 출발해요.", at: alert && alert.status !== "dispatched" ? (data?.dispatch?.endedAt ?? alert.raisedAt) : null },
    { who: "관제", what: "확인 → 처리 완료", say: "확인은 기록용. 구조자에게 구역 위험 정보를 넘겨요.", at: alert?.resolvedAt },
  ];
  const current = steps.findIndex((s) => !s.at);

  const post = async (path: string, body?: unknown) => {
    await api.post(path, body).catch((e) => window.alert(e instanceof Error ? e.message : "실패"));
    refresh();
  };

  const reset = async () => {
    if (!window.confirm("모든 데이터를 처음 상태로 되돌릴까요?")) return;
    await post("/debug/reset");
    setFrameKey((k) => k + 1);
  };

  return (
    <div className="min-h-dvh bg-slate-100">
      <header className="flex flex-wrap items-center gap-3 bg-slate-900 px-5 py-3 text-white">
        <Logo className="h-6 w-auto text-white" />
        <span className="rounded bg-amber-400 px-2 py-0.5 text-xs font-bold text-slate-900">시연 모드 · 발표자 전용</span>
        <span className="text-xs text-slate-400">실제 서비스 화면이 아니에요. 무대에서 흐름을 진행하는 도구예요.</span>
        <Link href="/" className="ml-auto text-sm text-slate-300 hover:text-white">
          서비스 화면으로 →
        </Link>
      </header>

      <main className="grid gap-5 p-5 xl:grid-cols-[380px_1fr_400px]">
        {/* 작업자 휴대폰 (실제로 조작 가능) */}
        <section className="space-y-2">
          <div className="text-center text-xs text-slate-500">작업반장 휴대폰 · {DEVICE} (여기서 바로 조작 가능)</div>
          <PhoneFrame>
            <iframe key={frameKey} title="작업 카드" src={work ? `/card?device=${DEVICE}&work=${work.id}` : `/card?device=${DEVICE}`} className="h-full w-full" />
          </PhoneFrame>
        </section>

        {/* 시나리오 */}
        <section className="card self-start">
          <div className="mb-3 flex items-center">
            <h2 className="font-bold">시나리오</h2>
            <span className="ml-auto text-xs text-slate-500">
              {work ? `${work.code} · ${work.title}` : "작업 없음"} · {current === -1 ? "완료" : `${current + 1}/${steps.length}단계`}
            </span>
          </div>
          <ol className="space-y-2">
            {steps.map((s, i) => {
              const state = s.at ? "done" : i === current ? "now" : "todo";
              return (
                <li key={s.what} className={`flex gap-3 rounded-lg p-3 ${state === "now" ? "bg-blue-50 ring-2 ring-blue-500" : state === "done" ? "bg-slate-50" : ""}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${state === "done" ? "bg-emerald-500 text-white" : state === "now" ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">{s.what}</span>
                      <span className="text-xs text-slate-400">{s.who}</span>
                      {s.at && <span className="ml-auto font-mono text-xs text-slate-500">{fmtTime(s.at)}</span>}
                    </div>
                    {state !== "todo" && <p className="mt-0.5 text-xs text-slate-600">{s.say}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {current === -1 && work && (
            <Link href={`/admin/works/${work.id}`} target="_blank" className="btn-primary mt-3 w-full">
              마무리: 작업 상세에서 전체 기록 보여주기 ↗
            </Link>
          )}
        </section>

        {/* 현장 상태 + 무대 도구 */}
        <section className="space-y-4">
          <div className="card space-y-2">
            <div className="flex items-center text-sm">
              <h2 className="font-bold">현장</h2>
              <span className="ml-auto text-xs text-slate-500">
                로봇 {data ? robotSummary(data.robot) : "-"}
              </span>
            </div>
            {data && (
              <ZoneMap
                zones={data.zones}
                tags={data.tags}
                robot={data.robot}
                path={data.dispatch?.status === "moving" ? data.dispatch.path : null}
                highlightZoneId={openAlert?.zoneId}
                helmets={data.presence}
                receivers={data.gateways}
              />
            )}
          </div>

          <div className="card space-y-2">
            <h2 className="font-bold">무대 트리거</h2>
            <p className="text-xs text-slate-500">휴대폰 센서가 안 될 때 대신 누르는 버튼이에요. 기록에는 ‘무대 트리거’로 남아요.</p>
            <div className="grid grid-cols-3 gap-2">
              {data?.zones.map((z) => (
                <button key={z.id} className="btn-danger" disabled={!!openAlert} onClick={() => post("/event", { source: "debug", deviceId: DEVICE, zoneId: z.id })}>
                  {z.id} 쓰러짐
                </button>
              ))}
            </div>
            {openAlert && (
              <div className="flex gap-2">
                {openAlert.status === "no_robot" && !openAlert.humanDispatchedAt && (
                  <button className="btn flex-1 bg-amber-300 text-slate-900" onClick={() => post("/alert/human", { alertId: openAlert.id })}>
                    사람 출동 지시
                  </button>
                )}
                {!openAlert.acknowledgedAt && (
                  <button className="btn-ghost flex-1" onClick={() => post("/alert/ack", { alertId: openAlert.id })}>
                    관제 확인
                  </button>
                )}
                <button className="btn-ghost flex-1" onClick={() => post("/alert/resolve", { alertId: openAlert.id, resolution: "handled" })}>
                  처리 완료
                </button>
              </div>
            )}
            <button className="btn-ghost w-full" onClick={reset}>
              데모 리셋 (지난 일주일 작업 6건 + 오늘 작업 2건)
            </button>
          </div>

          <div className="card space-y-2">
            <h2 className="font-bold">로봇 상태 바꾸기</h2>
            <p className="text-xs text-slate-500">“로봇이 충전 중이면?” 질문에 답하는 장면용이에요. 바꾼 뒤 쓰러짐을 일으켜 보세요.</p>
            <div className="grid grid-cols-4 gap-1">
              {(["ready", "charging", "maintenance", "offline"] as RobotMode[]).map((m) => (
                <button key={m} onClick={() => post("/robot/mode", { mode: m })} className={`btn px-1 text-xs ${data?.robot.mode === m ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}>
                  {ROBOT_MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="card space-y-1 text-sm">
            <h2 className="mb-1 font-bold">다른 화면 (새 창)</h2>
            {[
              ["/control", "관제 — 무대 화면에 띄우기"],
              ["/", "대시보드"],
              [work ? `/admin/works/${work.id}` : "/admin/works", "오늘 작업 상세"],
              ["/robot", "로봇"],
              ["/history", "이력"],
              [`/card?device=${DEVICE}`, "작업 카드 (큰 화면)"],
            ].map(([href, label]) => (
              <a key={href} href={href} target="_blank" className="block text-blue-600 hover:underline">
                {label} ↗
              </a>
            ))}
            <p className="pt-2 text-xs text-slate-500">
              실제 휴대폰: 같은 와이파이에서 <span className="font-mono">http://노트북IP:3000/card?device={DEVICE}</span>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
