"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { reportError, reportOk } from "@/lib/serverClock";

// 짧은 주기로 GET 을 반복한다 (웹소켓 대신 데모용 폴링). refresh() 로 즉시 다시 부를 수 있다.
export function usePolling<T>(path: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);

  const refresh = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api.get<T>(p);
      reportOk((d as { now?: string } | null)?.now);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "연결 오류";
      reportError(msg);
      setError(msg);
    }
  }, []);

  useEffect(() => {
    pathRef.current = path;
    if (!path) return;
    let alive = true;
    const run = async () => {
      if (alive) await refresh();
    };
    run();
    const id = setInterval(run, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path, intervalMs, refresh]);

  return { data, error, refresh };
}
