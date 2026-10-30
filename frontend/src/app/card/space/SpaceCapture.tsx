"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CardSpace } from "@/components/card3d/CardSpace";
import { usePolling } from "@/hooks/usePolling";
import type { CardResponse } from "@/lib/types";

// Presentation URL; GET only, no card-opened/confirmation/event mutations.
export function SpaceCapture() {
  const sp = useSearchParams();
  const workId = sp.get("work") ?? "8";
  const { data, error } = usePolling<CardResponse>(`/card?work=${encodeURIComponent(workId)}`, 10000);
  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-8 sm:py-10">
    <header className="flex items-end justify-between gap-3">
      <div>
        <p className="mb-2 text-xs font-bold tracking-wide text-blue-700">GaussX · 작업 공간</p>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{data?.work?.title ?? "배정된 위치와 주변 공정 위험"}</h1>
        <p className="mt-2 text-xs text-slate-500">{data?.zone?.name} · 배정된 설비와 주변 위험을 같은 공간에서 확인해요.</p>
      </div>
      <Link href={`/card?work=${encodeURIComponent(workId)}&preview=1`} className="shrink-0 text-xs text-slate-500 underline">작업 카드 보기</Link>
    </header>
    {data?.work ? <CardSpace work={data.work} tags={data.tags} expanded />
      : <div className="card py-12 text-center text-sm text-slate-500">{error ?? (data ? "이 작업을 찾지 못했어요." : "작업을 불러오는 중…")}</div>}
  </main>;
}
