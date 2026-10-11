"use client";
import { useSyncExternalStore } from "react";

// 서버 시각과 마지막 갱신 상태를 화면 전체가 같이 쓴다.
// 응답의 `now` 로 기기 시계와의 차이(offset)를 맞춰서, 경고 계산(서버 기준)과 상단 시계가 어긋나지 않게 한다.
type Sync = { offsetMs: number; lastOkAt: number | null; error: string | null };

let sync: Sync = { offsetMs: 0, lastOkAt: null, error: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function reportOk(serverNow?: string) {
  const local = Date.now();
  const server = serverNow ? new Date(serverNow).getTime() : NaN;
  sync = {
    offsetMs: Number.isFinite(server) ? server - local : sync.offsetMs,
    lastOkAt: local,
    error: null,
  };
  emit();
}

export function reportError(message: string) {
  if (sync.error === message) return;
  sync = { ...sync, error: message };
  emit();
}

const subscribeSync = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const useServerSync = () =>
  useSyncExternalStore(subscribeSync, () => sync, () => sync);

// 1초마다 바뀌는 값. 서버 렌더링 때는 null 이라 시계는 브라우저에서만 그린다 (hydration 불일치 방지).
const subscribeTick = (cb: () => void) => {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
};

export const useSecondTick = () =>
  useSyncExternalStore(subscribeTick, () => Math.floor(Date.now() / 1000), () => null);
