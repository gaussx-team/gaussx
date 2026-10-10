"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { usePolling } from "@/hooks/usePolling";
import { CATEGORY_LABEL, CATEGORY_STYLE, EVENT_LABEL, fmtDay, fmtTime, localDayKey, shiftDay } from "@/lib/format";
import type { EventCategory, HistoryEvent, HistoryResponse } from "@/lib/types";

const CATS: EventCategory[] = ["work", "check", "alert", "robot", "tag"];

// 필터는 주소(URL)에 그대로 담는다 → 새로고침·공유해도 같은 목록
export function HistoryView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const day = sp.get("day") ?? "today";
  const cats = (sp.get("cat")?.split(",").filter(Boolean) ?? []) as EventCategory[];
  const zone = sp.get("zone") ?? "";
  const work = sp.get("work") ?? "";
  const q = sp.get("q") ?? "";

  const { data } = usePolling<HistoryResponse>(`/history?${sp.toString() || "day=today"}`, 3000);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const allDays = day === "all";
  const baseDay = data ? (allDays ? data.today : data.day) : null;
  const toggleCat = (c: EventCategory) => setParams({ cat: (cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]).join(",") || null });

  const events = data?.events ?? [];
  const groups = groupByDay(events);
  const filtered = cats.length > 0 || zone || work || q;

  return (
    <AppShell
      title="이력"
      actions={
        <button className="btn-ghost" disabled={!events.length} onClick={() => downloadCsv(events, allDays ? "전체" : (data?.day ?? ""))}>
          CSV 내보내기
        </button>
      }
    >
      <div className="space-y-4">
        <section className="card space-y-3">
          {/* 날짜 */}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost px-2" disabled={!baseDay} onClick={() => baseDay && setParams({ day: shiftDay(baseDay, -1) })} aria-label="전날">
              ‹
            </button>
            <input type="date" className="input w-auto" value={allDays ? "" : (data?.day ?? "")} onChange={(e) => setParams({ day: e.target.value || null })} />
            <button className="btn-ghost px-2" disabled={!baseDay || (!allDays && baseDay >= (data?.today ?? ""))} onClick={() => baseDay && setParams({ day: shiftDay(baseDay, 1) })} aria-label="다음날">
              ›
            </button>
            <button className={`btn ${day === "today" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`} onClick={() => setParams({ day: null })}>
              오늘
            </button>
            <button className={`btn ${allDays ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`} onClick={() => setParams({ day: "all" })}>
              전체 기간
            </button>
            <span className="ml-auto text-sm text-slate-500">{events.length}건 · 수정·삭제할 수 없는 기록</span>
          </div>

          {/* 종류 · 구역 · 작업 · 검색 */}
          <div className="flex flex-wrap items-center gap-2">
            {CATS.map((c) => (
              <button key={c} onClick={() => toggleCat(c)} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${cats.includes(c) ? `${CATEGORY_STYLE[c]} ring-current` : "bg-white text-slate-500 ring-slate-200"}`}>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
            <select className="input w-auto" value={zone} onChange={(e) => setParams({ zone: e.target.value || null })}>
              <option value="">모든 구역</option>
              {data?.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            <select className="input w-auto max-w-56" value={work} onChange={(e) => setParams({ work: e.target.value || null })}>
              <option value="">모든 작업</option>
              {data?.works.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.title}
                </option>
              ))}
            </select>
            <input className="input w-auto min-w-48 flex-1" placeholder="설비 · 내용 · 작업 코드 검색" value={q} onChange={(e) => setParams({ q: e.target.value || null })} />
            {filtered && (
              <button className="text-xs text-slate-500 underline" onClick={() => setParams({ cat: null, zone: null, work: null, q: null })}>
                필터 초기화
              </button>
            )}
          </div>
        </section>

        {/* 요약 */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {CATS.map((c) => (
            <div key={c} className="card py-3">
              <div className="text-xs text-slate-500">{CATEGORY_LABEL[c]}</div>
              <div className="text-xl font-bold">{events.filter((e) => e.category === c).length}</div>
            </div>
          ))}
        </div>

        {/* 날짜별 목록 */}
        {groups.map(([key, rows]) => (
          <section key={key} className="card p-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm">
              <span className="font-bold">{fmtDay(key)}</span>
              <span className="text-slate-400">{rows.length}건</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((e) => (
                <li key={e.seq}>
                  <Row e={e} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {data && events.length === 0 && <div className="card py-12 text-center text-slate-400">조건에 맞는 기록이 없어요</div>}
      </div>
    </AppShell>
  );
}

function Row({ e }: { e: HistoryEvent }) {
  const inner = (
    <div className="grid grid-cols-[64px_56px_1fr] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm sm:grid-cols-[72px_56px_1fr_auto_auto]">
      <span className="font-mono text-xs text-slate-500">{fmtTime(e.at)}</span>
      <span className={`justify-self-start rounded px-1.5 py-0.5 text-xs font-semibold ${CATEGORY_STYLE[e.category]}`}>{CATEGORY_LABEL[e.category]}</span>
      <span className="min-w-0">
        <span className="font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span> <span className="text-slate-600">{e.text}</span>
      </span>
      <span className="col-start-3 text-xs text-slate-400 sm:col-start-auto">
        {e.actor}
        {e.zoneId && ` · ${e.zoneId}`}
      </span>
      <span className="hidden text-xs text-blue-600 sm:block">{e.workId ? `${e.workCode} 보기 →` : ""}</span>
    </div>
  );
  return e.workId ? (
    <Link href={`/admin/works/${e.workId}`} className="block hover:bg-slate-50">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function groupByDay(events: HistoryEvent[]) {
  const map = new Map<string, HistoryEvent[]>();
  for (const e of events) {
    const k = localDayKey(e.at);
    map.set(k, [...(map.get(k) ?? []), e]);
  }
  return [...map.entries()];
}

// 엑셀에서 한글이 깨지지 않게 BOM 을 붙인다
function downloadCsv(events: HistoryEvent[], label: string) {
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const head = ["시각", "분류", "구분", "작업", "구역", "누가", "내용"];
  const rows = events.map((e) => [new Date(e.at).toLocaleString("ko-KR"), CATEGORY_LABEL[e.category], EVENT_LABEL[e.type] ?? e.type, e.workCode, e.zoneId, e.actor, e.text]);
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `gaussx-이력-${label}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
