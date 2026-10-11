"use client";
import { useRef, useState } from "react";
import type { Drawing, Tag } from "@/lib/types";

// 도면 보기: 이미지·SVG 는 끌어서 이동 + 확대/축소, PDF 는 브라우저 기본 뷰어, CAD 원본은 내려받기만
// 평면도(mapsToFloor)는 태그 위치(4×3m)를 같은 좌표로 겹쳐 그린다
interface Props {
  drawing: Drawing;
  tags?: Tag[];
  highlight?: string | null; // 강조할 설비 번호
  className?: string;
}

export function DrawingViewer({ drawing, tags = [], highlight, className = "h-[70vh]" }: Props) {
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const isPdf = drawing.mime === "application/pdf" || /\.pdf$/i.test(drawing.fileName);

  if (drawing.cad)
    return (
      <div className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center ${className}`}>
        <div className="text-4xl">📐</div>
        <p className="font-semibold">CAD 원본은 브라우저에서 바로 볼 수 없어요</p>
        <p className="text-sm text-slate-500">내려받아 CAD 프로그램으로 열거나, PDF·이미지로 내보낸 도면을 함께 올려 주세요.</p>
        <a href={drawing.url} download={drawing.fileName} className="btn-primary">
          {drawing.fileName} 내려받기
        </a>
      </div>
    );

  if (isPdf) return <iframe title={drawing.title} src={drawing.url} className={`w-full rounded-lg border border-slate-200 bg-white ${className}`} />;

  const zoom = (factor: number, cx = 0.5, cy = 0.5) =>
    setView((v) => {
      const r = box.current?.getBoundingClientRect();
      const s = Math.min(8, Math.max(0.5, v.s * factor));
      if (!r) return { ...v, s };
      // 기준점(cx, cy)이 화면에서 제자리에 있도록 이동량 보정
      const px = r.width * cx;
      const py = r.height * cy;
      return { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s };
    });

  return (
    <div className={`relative overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}>
      <div
        ref={box}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        }}
      >
        <div className="relative origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 업로드 도면(동적 주소)이라 next/image 최적화 대상이 아님 */}
          <img src={drawing.url} alt={drawing.title} draggable={false} className="block w-full" />
          {drawing.mapsToFloor &&
            tags.map((t) => {
              const on = !!highlight && t.title.includes(highlight);
              return (
                <span key={t.id} title={`${t.title} — ${t.hazard}`} className="group absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(t.x / 4) * 100}%`, top: `${(t.y / 3) * 100}%` }}>
                  <span className={`block rounded-full border-2 border-white ${on ? "h-5 w-5 animate-ping bg-red-500" : "h-3.5 w-3.5"} ${t.official ? "bg-red-600" : "bg-amber-500"}`} />
                  {/* 도면 글자와 겹치지 않게 이름은 강조된 설비만 항상, 나머지는 마우스를 올렸을 때 */}
                  <span className={`absolute left-4 top-[-6px] whitespace-nowrap rounded bg-white/90 px-1 text-[10px] font-semibold text-slate-800 shadow ${on ? "" : "hidden group-hover:block"}`}>{t.title}</span>
                </span>
              );
            })}
        </div>
      </div>
      <div className="absolute right-2 top-2 flex gap-1">
        <button className="btn-ghost h-9 w-9 p-0 text-lg" onClick={() => zoom(1.3)} aria-label="확대">
          +
        </button>
        <button className="btn-ghost h-9 w-9 p-0 text-lg" onClick={() => zoom(1 / 1.3)} aria-label="축소">
          −
        </button>
        <button className="btn-ghost h-9 px-2 text-xs" onClick={() => setView({ s: 1, x: 0, y: 0 })}>
          맞춤
        </button>
      </div>
      {highlight && !drawing.mapsToFloor && <div className="absolute bottom-2 left-2 rounded bg-slate-900/80 px-2 py-1 text-xs text-white">도면에서 {highlight} 를 찾아보세요</div>}
    </div>
  );
}
