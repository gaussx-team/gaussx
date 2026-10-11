"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { usePolling } from "@/hooks/usePolling";
import { fmtShort, isOpen, workWarnings } from "@/lib/format";
import type { StateResponse, WorkView } from "@/lib/types";

const TABS = [
  { id: "active", label: "진행 중", match: (w: WorkView) => isOpen(w) },
  { id: "ended", label: "종료·취소", match: (w: WorkView) => !isOpen(w) },
  { id: "all", label: "전체", match: () => true },
] as const;

export default function WorksPage() {
  const router = useRouter();
  const { data } = usePolling<StateResponse>("/state", 1000);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("active");
  const [q, setQ] = useState("");

  const works = [...(data?.works ?? [])].reverse();
  const filtered = works
    .filter(TABS.find((t) => t.id === tab)!.match)
    .filter((w) => !q || `${w.code} ${w.title} ${w.deviceId}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <AppShell
      title="작업 등록"
      actions={
        <Link href="/admin/works/new" className="btn-primary">
          + 새 작업 등록
        </Link>
      }
    >
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-1 text-sm">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1 ${tab === t.id ? "bg-white font-semibold shadow-sm" : "text-slate-500"}`}>
                {t.label} <span className="text-xs text-slate-400">{works.filter(t.match).length}</span>
              </button>
            ))}
          </div>
          <input className="input ml-auto max-w-xs" placeholder="코드 · 작업명 · 기기 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="py-2">코드</th>
                <th>작업명</th>
                <th>구역</th>
                <th>받는 기기</th>
                <th>상태</th>
                <th className="w-44">작업 전 확인</th>
                <th className="pl-4">전송</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((w) => {
                // 카드 미확인 · 허가 시간 초과 (서버 시각 기준)
                const warns = data ? workWarnings(w, data.now) : [];
                return (
                  <tr key={w.id} onClick={() => router.push(`/admin/works/${w.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="py-3 font-mono text-xs">{w.code}</td>
                    <td className="font-medium">{w.title}</td>
                    <td>{w.zoneId}</td>
                    <td className="font-mono text-xs">{w.deviceId}</td>
                    <td>
                      <StatusBadge status={w.status} />
                      {warns.map((x) => (
                        <div key={x.kind} className="mt-0.5 text-xs font-semibold text-amber-600">
                          ⚠ {x.text}
                        </div>
                      ))}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${w.total ? (w.done / w.total) * 100 : 0}%` }} />
                        </div>
                        <span className="whitespace-nowrap text-xs text-slate-500">
                          {w.done}/{w.total}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap pl-4 text-xs text-slate-500">{fmtShort(w.publishedAt)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    해당하는 작업이 없어요
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
