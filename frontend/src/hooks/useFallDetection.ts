"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// 가속도 기반 쓰러짐 감지: 자유낙하(< 0.35g) 직후 1초 안에 충격(> 2.5g)이 오면 onFall.
// DeviceMotion 은 HTTPS(또는 localhost)에서만 동작하고, iOS 는 버튼을 눌러 권한을 받아야 한다.
const G = 9.81;
const FREEFALL = 0.35 * G;
const IMPACT = 2.5 * G;

type PermissionFn = () => Promise<"granted" | "denied">;

export function useFallDetection(enabled: boolean, onFall: () => void) {
  const [status, setStatus] = useState<"off" | "on" | "denied" | "unsupported">("off");
  const freefallAt = useRef(0);
  const cooldownUntil = useRef(0);
  const cb = useRef(onFall);
  useEffect(() => {
    cb.current = onFall;
  }, [onFall]);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window) || !window.isSecureContext) {
      setStatus("unsupported");
      return false;
    }
    const req = (DeviceMotionEvent as unknown as { requestPermission?: PermissionFn }).requestPermission;
    if (req) {
      const r = await req().catch(() => "denied" as const);
      if (r !== "granted") {
        setStatus("denied");
        return false;
      }
    }
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const mag = Math.hypot(a.x, a.y, a.z);
      const t = e.timeStamp;
      if (t < cooldownUntil.current) return;
      if (mag < FREEFALL) freefallAt.current = t;
      else if (mag > IMPACT && t - freefallAt.current < 1000) {
        cooldownUntil.current = t + 5000;
        cb.current();
      }
    };
    window.addEventListener("devicemotion", onMotion);
    const id = setTimeout(() => setStatus("on"), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("devicemotion", onMotion);
      setStatus("off");
    };
  }, [enabled]);

  return { status, requestPermission };
}
