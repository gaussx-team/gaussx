"use client";
import { useSyncExternalStore } from "react";

// 서버 시각과 마지막 갱신 상태를 화면 전체가 같이 쓴다.
// 응답의 `now` 로 기기 시계와의 차이(offset)를 맞춰서, 경고 계산(서버 기준)과 상단 시계가 어긋나지 않게 한다.
type Sync = { offsetMs: number; lastOkAt: number | null; error: string | null };

let sync: Sync = { offsetMs: 0, lastOkAt: null, error: null };
// 지금 실패 중인 경로들. 한 화면에서 여러 API 를 부를 때 하나만 실패해도 초록/빨강이 번갈아 깜빡이지 않게 경로별로 기억한다.
const failing = new Map<string, string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const firstError = () => failing.values().next().value ?? null;

export function reportOk(path: string, serverNow?: string) {
  const local = Date.now();
  const server = serverNow ? new Date(serverNow).getTime() : NaN;
  failing.delete(path);
  sync = {
    offsetMs: Number.isFinite(server) ? server - local : sync.offsetMs,
    lastOkAt: local,
    error: firstError(),
  };
  emit();
}

export function reportError(path: string, message: string) {
  failing.set(path, message);
  if (sync.error === firstError()) return;
  sync = { ...sync, error: firstError() };
  emit();
}

// 화면을 떠나 더 이상 부르지 않는 경로는 실패 목록에서 뺀다
export function forgetPath(path: string) {
  if (!failing.delete(path)) return;
  sync = { ...sync, error: firstError() };
  emit();
}

const subscribeSync = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const useServerSync = () => useSyncExternalStore(subscribeSync, () => sync, () => sync);

// 1초 단위 시계. 값은 타이머가 바꿀 때만 바뀌어서 렌더 중에 두 번 읽어도 같다.
// 서버 렌더링 때는 null 이라 시계는 브라우저에서만 그린다 (hydration 불일치 방지).
let tick = Math.floor(Date.now() / 1000);
const tickListeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const subscribeTick = (cb: () => void) => {
  tickListeners.add(cb);
  if (!timer) {
    tick = Math.floor(Date.now() / 1000);
    timer = setInterval(() => {
      tick = Math.floor(Date.now() / 1000);
      tickListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    tickListeners.delete(cb);
    if (tickListeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
};

export const useSecondTick = () => useSyncExternalStore(subscribeTick, () => tick, () => null);
