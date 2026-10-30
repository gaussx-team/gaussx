"use client";

import { useEffect, useRef, useState } from "react";
import { markerShortName, type CardSceneConfig, type SceneMarker } from "@/lib/card3d/scene";
import type { CardSceneRuntime, SceneFrame } from "@/lib/card3d/runtime.mjs";

type LoadState = { phase: "loading" | "ready" | "missing" | "error"; progress?: number | null; message?: string; count?: number };

export default function CardSceneCanvas({ config, modelUrl, markers, preset, expanded, capture, onSelect, onHome, homeRevision }: {
  config: CardSceneConfig; modelUrl: string; markers: SceneMarker[]; preset: string; expanded: boolean; capture: boolean;
  onSelect: (id: string) => void; onHome: () => void; homeRevision: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<CardSceneRuntime | null>(null);
  const inputs = useRef({ markers, preset });
  const [load, setLoad] = useState<LoadState>({ phase: "loading", progress: null });
  const [frame, setFrame] = useState<SceneFrame | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    inputs.current = { markers, preset };
    runtime.current?.setMarkers(markers);
  }, [markers, preset]);
  useEffect(() => { runtime.current?.setPreset(preset); }, [preset, homeRevision]);
  useEffect(() => {
    let alive = true;
    let instance: CardSceneRuntime | null = null;
    import("@/lib/card3d/runtime.mjs").then(({ createCardScene }) => {
      if (!alive || !canvas.current) return;
      instance = createCardScene(canvas.current, {
        config, modelUrl, presentation: capture, ...inputs.current,
        getReservedRects: () => {
          const surface = canvas.current?.parentElement;
          if (!surface) return [];
          const origin = surface.getBoundingClientRect();
          return [...surface.querySelectorAll("[data-scene-reserved]")].map((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
          });
        },
        onFrame: (next) => { if (alive) setFrame(next); },
        onProgress: (progress) => { if (alive) setLoad({ phase: "loading", progress }); },
        onLoaded: ({ count }) => { if (alive) setLoad({ phase: "ready", count }); },
        onError: ({ kind, message }) => { if (alive) setLoad({ phase: kind === "missing" ? "missing" : "error", message }); },
      });
      runtime.current = instance;
    }).catch((error: Error) => { if (alive) setLoad({ phase: "error", message: error.message }); });
    return () => {
      alive = false;
      runtime.current = null;
      instance?.dispose();
    };
  }, [config, modelUrl, attempt, capture]);

  const ready = load.phase === "ready";
  useEffect(() => { if (ready) runtime.current?.refreshLayout(); }, [ready]);
  const compact = (frame?.width ?? (expanded ? 800 : 311)) < 480;
  // A polling update may remove a tag before the next projected frame arrives.
  const visibleBoxes = frame?.boxes.filter((box) => markers.some((marker) => marker.id === box.id)) ?? [];
  return (
    <div className={`card-space-canvas relative overflow-hidden bg-slate-200 ${expanded ? "h-[306px] md:aspect-video md:h-auto" : "h-[306px]"}`}
      data-card-scene data-status={load.phase} data-gaussian-count={load.count} data-preset={frame?.preset}
      data-camera-preset={frame?.cameraPreset} data-label-layout={compact ? "compact" : capture ? "presentation" : "normal"}>
      <canvas key={attempt} ref={canvas} className="block h-full w-full touch-none outline-none" role="img"
        aria-label="배정된 작업 설비의 3D 공간. 드래그로 회전하고 두 손가락이나 휠로 확대할 수 있어요."
        data-camera={frame ? JSON.stringify(frame.camera) : undefined} />
      {ready && <>
        <div data-scene-reserved className="card-scene-chip pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-white/70 bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          {config.displayName && <>{config.displayName} · </>}{config.presets[preset]?.label ?? "내 작업 위치"}
        </div>
        {frame && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${frame.width} ${frame.height}`} aria-hidden="true">
          {visibleBoxes.map((box) => <g key={box.id}>
            <line x1={box.x} y1={box.y} x2={box.left + box.width / 2} y2={box.top + box.height / 2}
              stroke={box.kind === "work" ? "#2563eb" : markers.find((m) => m.id === box.id)?.official ? "#dc2626" : "#d97706"} strokeWidth="1.25" opacity=".8" />
            <circle cx={box.x} cy={box.y} r={compact ? 4 : 6} fill="white" opacity=".9" />
            <circle cx={box.x} cy={box.y} r={compact ? 2 : 3} fill={box.kind === "work" ? "#2563eb" : markers.find((m) => m.id === box.id)?.official ? "#dc2626" : "#d97706"} />
          </g>)}
        </svg>}
        {visibleBoxes.map((box) => {
          const marker = markers.find((m) => m.id === box.id);
          if (!marker) return null;
          return <button key={box.id} type="button" onClick={() => onSelect(marker.id)} data-world-label={marker.id}
            className={`card-world-label absolute rounded-lg border border-white/90 border-l-[3px] bg-white/95 px-2 text-left shadow-md ${compact ? "flex items-center py-0 text-[10px] font-semibold" : "py-1.5"} ${marker.kind === "work" ? "border-l-blue-500" : marker.official ? "border-l-red-500" : "border-l-amber-500"}`}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            aria-label={`${marker.title}, ${marker.kind === "work" ? "내 작업 위치" : `${marker.distanceMeters.toFixed(1)}미터, ${marker.substance || marker.hazard}${marker.official ? "" : ", 미검증"}`}`}>
            {compact ? <span className="truncate">{markerShortName(marker)}</span> : <><span className="card-world-label-title flex items-center justify-between gap-1 text-[11px] font-bold text-slate-900">
              {marker.id}<span className={`card-world-label-distance ${marker.kind === "work" ? "text-[9px] text-blue-600" : "text-[10px] font-medium text-slate-500"}`}>
                {marker.kind === "work" ? "내 작업" : `${marker.distanceMeters.toFixed(1)}m`}
              </span>
            </span>
            <span className="card-world-label-detail mt-0.5 block truncate text-[9px] text-slate-600">{marker.kind === "work" ? "배정된 점검 위치" : marker.substance || marker.title}</span></>}
          </button>;
        })}
        <button data-scene-reserved type="button" onClick={onHome} className="card-scene-home absolute bottom-10 right-3 rounded-full border border-white/80 bg-white/95 px-2.5 py-1.5 text-[10px] font-semibold text-slate-800 shadow-sm">
          ↺ 내 위치로 돌아가기
        </button>
      </>}
      {!ready && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100 px-6 pb-7 text-center" role="status" aria-live="polite">
        {load.phase === "loading" ? <>
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          <p className="text-sm font-semibold text-slate-700">내 작업 공간을 여는 중</p>
          <p className="text-xs text-slate-500">{load.progress != null ? `${Math.min(100, Math.round(load.progress * 100))}%` : "처음에는 잠시 걸릴 수 있어요"}</p>
        </> : <>
          <span className="text-2xl text-slate-400" aria-hidden="true">◇</span>
          <p className="text-sm font-semibold text-slate-700">{load.phase === "missing" ? "3D 장면 파일 없음" : "3D 공간을 열지 못했어요"}</p>
          <p className="text-xs leading-5 text-slate-500">{load.phase === "missing" ? "받는 방법: " : "연결 상태와 장면 파일을 확인해 주세요. "}
            <a className="font-semibold text-blue-700 underline underline-offset-2" href="/card/space/help" target="_blank" rel="noreferrer">docs 안내</a>
          </p>
          <button className="btn-ghost text-xs" onClick={() => { setLoad({ phase: "loading" }); setAttempt((n) => n + 1); }}>다시 열기</button>
        </>}
      </div>}
      <div data-scene-reserved className="card-scene-notice pointer-events-none absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/70 to-transparent px-3 pb-2 pt-5 text-[9px] leading-4 text-white">
        생성형 AI로 만든 시연용 가상 공장
      </div>
    </div>
  );
}
