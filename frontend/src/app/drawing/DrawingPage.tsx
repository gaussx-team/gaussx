"use client";
import { useSearchParams } from "next/navigation";
import { DrawingViewer } from "@/components/DrawingViewer";
import { usePolling } from "@/hooks/usePolling";
import { DRAWING_KIND_LABEL } from "@/lib/format";
import type { DrawingsResponse, TagsResponse } from "@/lib/types";

// 도면 한 장 크게 보기 (작업 카드·관제·작업 상세에서 연다). ?id=도면 &eq=강조할 설비 번호
export function DrawingPage() {
  const sp = useSearchParams();
  const id = Number(sp.get("id"));
  const eq = sp.get("eq");
  const { data } = usePolling<DrawingsResponse>("/drawings", 10000);
  const { data: tagData } = usePolling<TagsResponse>("/tags", 10000);
  const d = data?.drawings.find((x) => x.id === id);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button className="text-sm font-semibold text-slate-700" onClick={() => history.back()}>
          ← 돌아가기
        </button>
        <div className="min-w-0">
          <div className="truncate font-bold">{d?.title ?? "도면"}</div>
          {d && (
            <div className="truncate text-xs text-slate-500">
              {DRAWING_KIND_LABEL[d.kind]} · {d.dwgNo} · {d.revision}
            </div>
          )}
        </div>
      </header>
      <main className="flex-1 p-2">
        {d ? <DrawingViewer drawing={d} tags={tagData?.tags} highlight={eq} className="h-[calc(100dvh-80px)]" /> : <p className="p-6 text-center text-slate-500">{data ? "도면을 찾을 수 없어요" : "불러오는 중…"}</p>}
      </main>
    </div>
  );
}
