"use client";
import { useEffect, useRef, useState } from "react";

// 길게 눌러야 실행되는 버튼 (SOS 오작동 방지). 기본 3초.
export function HoldButton({ onDone, ms = 3000, children }: { onDone: () => void; ms?: number; children: React.ReactNode }) {
  const [pct, setPct] = useState(0);
  const start = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const stop = () => {
    start.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    setPct(0);
  };

  const step = (t: number) => {
    if (start.current === null) start.current = t;
    const p = Math.min(1, (t - start.current) / ms);
    setPct(p);
    if (p >= 1) {
      stop();
      onDone();
      return;
    }
    raf.current = requestAnimationFrame(step);
  };

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  return (
    <button
      type="button"
      onPointerDown={() => (raf.current = requestAnimationFrame(step))}
      onPointerUp={stop}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()}
      className="relative w-full select-none overflow-hidden rounded-2xl bg-red-600 py-6 text-xl font-bold text-white touch-none"
    >
      <span className="absolute inset-y-0 left-0 bg-red-800" style={{ width: `${pct * 100}%` }} />
      <span className="relative">{children}</span>
    </button>
  );
}
