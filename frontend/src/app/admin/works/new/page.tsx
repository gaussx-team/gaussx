"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ZoneMap } from "@/components/ZoneMap";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { DEVICES } from "@/lib/devices";
import type { StateResponse, Work } from "@/lib/types";


// 지금 정시 + n시간 (ISO)
const hourFromNow = (plusH: number) => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + plusH);
  return d.toISOString();
};

// <input type="time"> 값을 오늘 날짜의 ISO 로
const todayIso = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export default function NewWorkPage() {
  const router = useRouter();
  const { data } = usePolling<StateResponse>("/state", 3000);
  const [title, setTitle] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [deviceId, setDeviceId] = useState(DEVICES[0].id);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [permitName, setPermitName] = useState<string | null>(null);
  // 비워두면 '지금 정시 ~ 8시간 뒤' (밤에 리허설해도 바로 '허가 초과'가 뜨지 않게)
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // 구역을 고르면 그 구역 태그가 자동으로 묶인다 (빼고 싶은 것만 체크 해제)
  const zoneTags = data?.tags.filter((t) => t.zoneId === zoneId) ?? [];
  const tagIds = zoneTags.map((t) => t.id).filter((id) => !excluded.includes(id));
  const items = zoneTags.filter((t) => tagIds.includes(t.id)).flatMap((t) => t.checkItems);
  const requiredCount = items.filter((c) => c.required).length;

  const pickZone = (id: string) => {
    setZoneId(id);
    setExcluded([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ps = start ? todayIso(start) : hourFromNow(0);
    let pe = end ? todayIso(end) : hourFromNow(8);
    if (pe <= ps) pe = new Date(new Date(pe).getTime() + 86_400_000).toISOString(); // 자정을 넘기는 허가
    try {
      const w = await api.post<Work>("/work", { title, zoneId, deviceId, tagIds, permitName, permitStart: ps, permitEnd: pe });
      router.push(`/admin/works/${w.id}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "실패했어요");
    }
  };

  return (
    <AppShell title="새 작업 등록" crumbs={[{ href: "/admin/works", label: "작업 등록" }]}>
      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="card space-y-3">
            <h2 className="font-bold">1. 작업 정보</h2>
            <div>
              <label className="label">작업명</label>
              <input className="input" placeholder="P-203 배관 플랜지 교체" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className="label">허가 시작 (비우면 지금 정시)</label>
                <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <label className="label">허가 종료 (비우면 +8시간)</label>
                <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div>
                <label className="label">받는 기기 (로그인 없음)</label>
                <select className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                  {DEVICES.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label} · {d.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label">작업허가서 PDF (목업은 파일 이름만 저장)</label>
              <input className="input" type="file" accept="application/pdf" onChange={(e) => setPermitName(e.target.files?.[0]?.name ?? null)} />
            </div>
          </section>

          <section className="card space-y-3">
            <h2 className="font-bold">2. 구역 선택</h2>
            <div className="flex flex-wrap gap-2">
              {data?.zones.map((z) => (
                <button type="button" key={z.id} onClick={() => pickZone(z.id)} className={`btn ${zoneId === z.id ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}>
                  {z.name}
                </button>
              ))}
            </div>
            {data && <ZoneMap zones={data.zones} tags={data.tags} highlightZoneId={zoneId || null} />}
          </section>
        </div>

        <aside className="card space-y-3 self-start lg:sticky lg:top-4">
          <h2 className="font-bold">3. 함께 보낼 위험 태그</h2>
          {!zoneId && <p className="text-sm text-slate-500">구역을 고르면 그 구역 태그가 자동으로 들어가요.</p>}
          {zoneId && zoneTags.length === 0 && <p className="text-sm text-slate-500">이 구역엔 태그가 없어요. 위험 태그에서 먼저 만들어 주세요.</p>}
          {zoneTags.map((t) => (
            <label key={t.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={!excluded.includes(t.id)}
                onChange={(e) => setExcluded((x) => (e.target.checked ? x.filter((id) => id !== t.id) : [...x, t.id]))}
              />
              <span>
                <span className="font-semibold">{t.title}</span>
                {!t.official && <span className="ml-1 text-xs text-amber-600">미검증</span>}
                <span className="block text-xs text-slate-500">{t.hazard}</span>
                <span className="block text-xs text-slate-400">확인 항목 {t.checkItems.length}개</span>
              </span>
            </label>
          ))}
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            확인 항목 {items.length}개 중 <b>필수 {requiredCount}개</b>를 확인해야 작업을 시작할 수 있어요.
          </div>
          <button className="btn-primary w-full py-3">작업 등록 · 전송</button>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </aside>
      </form>
    </AppShell>
  );
}
