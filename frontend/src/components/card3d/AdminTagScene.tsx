"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { adminSceneMarkers, adminScenePreset, sceneModelUrl, validateSceneConfig, type CardSceneConfig } from "@/lib/card3d/scene";
import type { Tag } from "@/lib/types";

const CardSceneCanvas = dynamic(() => import("./CardSceneCanvas"), { ssr: false });

export function AdminTagScene({ tags, selectedTagId, selectionRevision, onSelect, onSiteName, fallback }: {
  tags: Tag[]; selectedTagId: number | null; selectionRevision: number; onSelect: (id: number | null) => void;
  onSiteName: (name: string | undefined) => void; fallback: ReactNode;
}) {
  const [scene, setScene] = useState<{ config: CardSceneConfig; modelUrl: string } | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    const abort = new AbortController();
    fetch("/scenes/card-active.json", { signal: abort.signal, cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("장면 설정 없음"); return response.json(); })
      .then((value: unknown) => {
        const config = validateSceneConfig(value);
        setScene({ config, modelUrl: sceneModelUrl(config, process.env.NEXT_PUBLIC_GAUSSX_SCENE_URL) });
      })
      .catch(() => { if (!abort.signal.aborted) setPhase("missing"); });
    return () => abort.abort();
  }, []);

  const displayName = scene?.config.displayName || scene?.config.label;
  useEffect(() => {
    onSiteName(phase === "ready" ? displayName : undefined);
    return () => onSiteName(undefined);
  }, [phase, displayName, onSiteName]);
  const onStatus = useCallback((next: typeof phase) => setPhase(next), []);
  const failed = phase === "missing" || phase === "error";
  const markers = scene ? adminSceneMarkers(scene.config, tags) : [];
  const selected = markers.find((marker) => marker.id === String(selectedTagId));
  const preset = scene ? adminScenePreset(scene.config, selected?.equipmentId) : "nearby";

  return <section className="card space-y-2 lg:flex lg:min-h-0 lg:flex-col lg:gap-2 lg:space-y-0" aria-label="위험 태그 현장" data-admin-tag-scene={failed ? "2d" : phase}>
    <div className="flex items-center justify-between gap-2">
      <h2 className="shrink-0 font-bold">{failed ? "현장 평면도" : "3D 현장"}</h2>
      <span className="text-xs text-slate-500">{failed ? "3D를 열 수 없어 평면도로 표시해요" : "핀·목록을 누르면 설비 위치로 이동해요"}</span>
    </div>
    <div className="h-[540px] overflow-hidden rounded-lg lg:min-h-0 lg:flex-1">
      {failed ? fallback : scene ? <CardSceneCanvas config={scene.config} modelUrl={scene.modelUrl} markers={markers}
        preset={preset} expanded capture={false} mode="admin" selectedId={selected?.id} homeRevision={selectionRevision}
        onSelect={(id) => onSelect(Number(id))} onStatusChange={onStatus}
        onHome={() => onSelect(null)} />
        : <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500" role="status">3D 현장 준비 중…</div>}
    </div>
    {scene && !failed && markers.length < tags.length && <p className="text-xs text-slate-500">장면에 연결되지 않은 태그는 오른쪽 목록에서 확인해 주세요.</p>}
  </section>;
}
