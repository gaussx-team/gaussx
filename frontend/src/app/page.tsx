"use client";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { ZoneMap } from "@/components/ZoneMap";
import { usePolling } from "@/hooks/usePolling";
import { EVENT_LABEL, fmtDay, fmtTime, isOpen, robotSummary, SOURCE_LABEL, UNSEEN_MIN, workWarnings } from "@/lib/format";
import type { StateResponse } from "@/lib/types";

// 대시보드: 원청 담당자가 처음 들어와서 오늘 현장 상황을 한눈에 보는 화면
export default function Dashboard() {
  const { data } = usePolling<StateResponse>("/state", 1000);

  const active = data?.works.filter(isOpen) ?? [];
  // 경고가 있는 작업 (카드 미확인 · 허가 시간 초과)
  const warned = data ? active.map((w) => ({ w, list: workWarnings(w, data.now) })).filter((x) => x.list.length) : [];
  const unseen = warned.filter((x) => x.list.some((l) => l.kind === "unseen"));
  const working = active.filter((w) => w.status === "confirmed");
  const openAlerts = data?.alerts.filter((a) => a.status !== "resolved") ?? [];
  const robot = data ? robotSummary(data.robot) : "-";
  // 로봇이 출동할 수 없는 상태면 미리 알린다 (알림이 와도 사람이 가야 함)
  const robotDown = !!data && data.robot.mode !== "ready";

  const kpis = [
    { label: "진행 중 작업", value: active.length, sub: `작업 중 ${working.length}`, href: "/admin/works" },
    { label: "카드 미확인", value: unseen.length, sub: `전송 후 ${UNSEEN_MIN}분 넘게 안 열림`, href: "/admin/works", warn: unseen.length > 0 },
    { label: "열린 알림", value: openAlerts.length, sub: "쓰러짐 · SOS · 측정 이상", href: "/control", danger: openAlerts.length > 0 },
    { label: "로봇", value: robot, sub: data ? `배터리 ${data.robot.battery}%` : "", href: "/robot", warn: !!data && !data.robot.available && data.robot.state !== "moving" },
  ];

  return (
    <AppShell
      title={data ? `${fmtDay(data.now)} 현장 현황` : "현장 현황"}
      actions={
        <>
          <Link href="/demo" className="btn border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100">
            ▶ 시연 모드
          </Link>
          <Link href="/admin/tags" className="btn-ghost">
            위험 태그 등록
          </Link>
          <Link href="/admin/works/new" className="btn-primary">
            + 새 작업 등록
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        {openAlerts.map((a) =>
          a.type === "abnormal" ? (
            <Link key={a.id} href="/control" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-100 p-4 text-amber-950">
              <span className="text-2xl">!</span>
              <span>
                <span className="block font-bold">
                  측정 이상 · {data?.zones.find((z) => z.id === a.zoneId)?.name} · {a.reading?.tagTitle}
                </span>
                <span className="text-xs">
                  {a.reading?.item} {a.reading?.value}
                  {a.reading?.unit} (정상 {a.reading?.range}) · {fmtTime(a.raisedAt)} · {a.reading?.recheckedAt ? "재측정 정상" : a.acknowledgedAt ? "관제 확인됨" : "관제 확인 대기"}
                </span>
              </span>
              <span className="ml-auto text-sm font-semibold">관제 화면으로 →</span>
            </Link>
          ) : (
          <Link key={a.id} href="/control" className="flex items-center gap-3 rounded-xl bg-red-600 p-4 text-white shadow">
            <span className="text-2xl">!</span>
            <span>
              <span className="block font-bold">
                쓰러짐 알림 · {data?.zones.find((z) => z.id === a.zoneId)?.name ?? "구역 불명"}
              </span>
              <span className="text-xs opacity-90">
                {SOURCE_LABEL[a.source]} · {fmtTime(a.raisedAt)} · {a.status === "no_robot" ? (a.humanDispatchedAt ? "사람 출동 중" : `로봇 출동 불가(${a.robotUnavailable}) — 사람 출동 필요`) : a.acknowledgedAt ? "관제 확인됨" : "관제 확인 대기"}
              </span>
            </span>
            <span className="ml-auto text-sm font-semibold">관제 화면으로 →</span>
          </Link>
          ),
        )}

        {warned.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="mb-1 font-bold">확인이 필요한 작업</div>
            {warned.map(({ w, list }) => (
              <Link key={w.id} href={`/admin/works/${w.id}`} className="flex gap-2 hover:underline">
                <span className="font-mono text-xs">{w.code}</span>
                <span>{w.title}</span>
                <span className="ml-auto font-semibold">{list.map((l) => l.text).join(" · ")}</span>
              </Link>
            ))}
          </div>
        )}

        {robotDown && (
          <Link href="/robot" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-bold">로봇 출동 불가</span>
            <span>{robot} — 지금 쓰러짐 알림이 오면 관제가 사람을 보내야 해요</span>
            <span className="ml-auto text-xs">로봇 →</span>
          </Link>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className={`card hover:border-slate-400 ${k.danger ? "border-red-300 bg-red-50" : k.warn ? "border-amber-300 bg-amber-50" : ""}`}>
              <div className="text-xs text-slate-500">{k.label}</div>
              <div className={`mt-1 text-2xl font-bold ${k.danger ? "text-red-700" : k.warn ? "text-amber-700" : ""}`}>{k.value}</div>
              <div className="text-xs text-slate-400">{k.sub}</div>
            </Link>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <section className="card">
            <div className="mb-2 flex items-center">
              <h2 className="font-bold">진행 중인 작업</h2>
              <Link href="/admin/works" className="ml-auto text-xs text-blue-600">
                전체 보기 →
              </Link>
            </div>
            {active.length === 0 && <p className="py-8 text-center text-sm text-slate-400">진행 중인 작업이 없어요</p>}
            <ul className="divide-y divide-slate-100">
              {active.map((w) => (
                <li key={w.id}>
                  <Link href={`/admin/works/${w.id}`} className="-mx-2 flex items-center gap-3 rounded px-2 py-2.5 text-sm hover:bg-slate-50">
                    <span className="font-mono text-xs text-slate-500">{w.code}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{w.title}</span>
                    <span className="text-xs text-slate-500">{w.zoneId}</span>
                    <span className="w-14 text-right text-xs text-slate-500">
                      {w.done}/{w.total}
                    </span>
                    <StatusBadge status={w.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="card space-y-2">
            <div className="flex items-center">
              <h2 className="font-bold">구역 상태</h2>
              <Link href="/control" className="ml-auto text-xs text-blue-600">
                관제 →
              </Link>
            </div>
            {data && <ZoneMap zones={data.zones} tags={data.tags} robot={data.robot} />}
          </section>
        </div>

        <section className="card">
          <div className="mb-2 flex items-center">
            <h2 className="font-bold">오늘 기록</h2>
            <Link href="/history" className="ml-auto text-xs text-blue-600">
              이력 →
            </Link>
          </div>
          <ol className="space-y-1 text-sm">
            {data?.events.slice(0, 8).map((e) => (
              <li key={e.seq} className="flex gap-3">
                <span className="shrink-0 font-mono text-xs text-slate-400">{fmtTime(e.at)}</span>
                <span className="shrink-0 font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="truncate text-slate-600">{e.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </AppShell>
  );
}
