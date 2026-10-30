"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { assignedEquipment, sceneMarkers, sceneModelUrl, validateSceneConfig, type CardSceneConfig, type SceneMarker } from "@/lib/card3d/scene";
import type { Tag, TagsResponse, Work } from "@/lib/types";
import "./card3d.css";

const CardSceneCanvas = dynamic(() => import("./CardSceneCanvas"), {
  ssr: false,
  loading: () => <div className="flex h-[306px] items-center justify-center bg-slate-100 text-xs text-slate-500">3D 보기 준비 중…</div>,
});

export function CardSpace({ work, tags, expanded = false, capture = false }: { work: Work; tags: Tag[]; expanded?: boolean; capture?: boolean }) {
  const [config, setConfig] = useState<CardSceneConfig | null>(null);
  const [error, setError] = useState("");
  const { data: nearby, error: nearbyError } = usePolling<TagsResponse>("/tags", 10000);
  const sp = useSearchParams();

  useEffect(() => {
    const abort = new AbortController();
    fetch("/scenes/card-active.json", { signal: abort.signal, cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("3D 좌표 설정을 준비 중이에요."); return r.json(); })
      .then((value: unknown) => { setConfig(validateSceneConfig(value)); })
      .catch((e: Error) => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, []);

  if (!config) return <section className="card text-sm text-slate-500" aria-label="내 작업 공간">
    {error || "내 작업 공간 준비 중…"}{error && <> <a className="text-blue-700 underline" href="/card/space/help">docs 안내</a></>}
  </section>;
  const equipment = assignedEquipment(config, work.title, tags);
  if (!equipment) return null;
  const markers = sceneMarkers(config, equipment, tags, nearby?.tags ?? []);
  return <SpacePanel key={`${config.id}:${work.id}`} config={config} equipment={equipment} markers={markers}
    expanded={expanded} capture={capture} requestedPreset={sp.get("view3d") ?? "work"} nearbyLoading={!nearby} nearbyError={nearbyError} />;
}

function SpacePanel({ config, equipment, markers, expanded, capture, requestedPreset, nearbyLoading, nearbyError }: {
  config: CardSceneConfig; equipment: string; markers: SceneMarker[]; expanded: boolean; capture: boolean; requestedPreset: string;
  nearbyLoading: boolean; nearbyError: string | null;
}) {
  const workPreset = equipment === config.defaultWorkEquipment ? "work" : equipment;
  const [preset, setPreset] = useState(config.presets[requestedPreset] ? requestedPreset === "work" ? workPreset : requestedPreset : workPreset);
  const [selected, setSelected] = useState<string | null>(null);
  const [homeRevision, setHomeRevision] = useState(0);
  const hazards = markers.filter((m) => m.kind === "hazard");
  const active = markers.find((m) => m.id === selected);
  let modelUrl: string;
  try { modelUrl = sceneModelUrl(config, process.env.NEXT_PUBLIC_GAUSSX_SCENE_URL); }
  catch { return <section className="card text-sm text-slate-600">3D 장면 주소를 확인해 주세요. <a href="/card/space/help" className="text-blue-700 underline">docs 안내</a></section>; }

  function selectMarker(id: string) { setSelected((previous) => previous === id ? null : id); }
  function home() { setPreset(workPreset); setSelected(null); setHomeRevision((n) => n + 1); }

  return <section className={`card-space-panel overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${capture ? "card-space-panel-capture" : ""}`} aria-label="내 작업 공간">
    <div className="card-space-header flex items-center justify-between gap-2 px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m10 1.8 7.3 4.1v8.2L10 18.2l-7.3-4.1V5.9L10 1.8Z M2.7 5.9 10 10l7.3-4.1M10 10v8.2" /></svg>
        </span>
        <div><h2 className="text-sm font-bold text-slate-900">내 작업 공간</h2><p className="text-[10px] text-slate-500">{equipment} · 배정 위치</p></div>
      </div>
      <div className="flex shrink-0 rounded-lg bg-slate-100 p-0.5 text-[10px] font-semibold" role="group" aria-label="3D 시점">
        <button type="button" aria-pressed={preset === workPreset} onClick={home}
          className={`rounded-md px-2 py-1.5 ${preset === workPreset ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>배정 위치</button>
        <button type="button" aria-pressed={preset === "nearby"} onClick={() => { setPreset("nearby"); setSelected(null); }}
          className={`rounded-md px-2 py-1.5 ${preset === "nearby" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>주변 위험</button>
      </div>
    </div>
    <div className={`card-space-content ${expanded ? "md:grid md:grid-cols-[minmax(0,1fr)_264px]" : ""}`}>
      <CardSceneCanvas config={config} modelUrl={modelUrl} markers={markers} preset={preset} expanded={expanded} capture={capture}
        onSelect={selectMarker} onHome={home} homeRevision={homeRevision} />
      <div className={`card-risk-list space-y-2.5 p-3 ${expanded ? "md:border-l md:border-slate-200 md:p-4" : ""}`}>
        <div className="card-risk-list-heading flex items-center justify-between text-[10px]">
          <span className="font-semibold text-slate-700">주변 공정 위험 <span className="ml-0.5 text-red-600">{hazards.length}</span></span>
          <span className="text-slate-400">설비 간 직선거리</span>
        </div>
        {hazards.map((marker) => <button type="button" key={marker.id} onClick={() => selectMarker(marker.id)}
          className={`card-risk-item flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${selected === marker.id ? "border-slate-400 bg-slate-50" : "border-slate-100 hover:bg-slate-50"}`}
          aria-expanded={selected === marker.id}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${marker.official ? "bg-red-500" : "bg-amber-500"}`} />
          <span className="min-w-0 flex-1"><span className="card-risk-title block text-[11px] font-bold text-slate-800">{marker.title}</span>
            <span className="card-risk-substance block truncate text-[10px] text-slate-500">{marker.substance}{!marker.official && " · 미검증"}</span></span>
          <span className="card-risk-distance shrink-0 text-[11px] font-semibold tabular-nums text-slate-600">{marker.distanceMeters.toFixed(1)}<span className="ml-0.5 text-[9px] font-normal">m</span></span>
        </button>)}
        {nearbyError ? <p className="text-[10px] text-amber-700">주변 위험의 최신 정보를 받지 못했어요.</p>
          : nearbyLoading ? <p className="text-[10px] text-slate-400">주변 위험 정보를 불러오는 중…</p>
          : !hazards.length && <p className="text-[10px] text-slate-500">이 장면의 표시 범위에 등록된 주변 공정 위험이 없어요.</p>}
        {active && <div className="card-risk-details rounded-lg bg-slate-50 p-2.5 text-[11px] leading-5" role="status">
          <p className="font-bold text-slate-800">{active.title} {active.kind === "work" && <span className="text-blue-700">· 내 작업</span>}</p>
          <p className="text-red-700">{active.hazard}</p>
          {active.kind === "hazard" && config.presets[active.id] && <button type="button" onClick={() => setPreset(active.id)} className="mt-1 font-semibold text-blue-700 underline underline-offset-2">설비 위치 보기 →</button>}
        </div>}
        <p className="card-scene-instructions text-[9px] leading-4 text-slate-400">드래그로 회전 · 두 손가락/휠로 확대<br />태그는 가려진 설비도 표시해요.</p>
      </div>
    </div>
  </section>;
}
