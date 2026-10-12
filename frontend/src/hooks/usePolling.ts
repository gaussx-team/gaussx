"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { forgetPath, reportError, reportOk } from "@/lib/serverClock";

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
      if (pathRef.current !== p) return; // 화면을 떠났거나 경로가 바뀐 뒤 도착한 응답은 버린다
      reportOk(p, (d as { now?: string } | null)?.now);
      setData(d);
      setError(null);
    } catch (e) {
      if (pathRef.current !== p) return;
      const msg = e instanceof Error ? e.message : "연결 오류";
      reportError(p, msg);
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
      pathRef.current = null;
      forgetPath(path);
    };
  }, [path, intervalMs, refresh]);

  return { data, error, refresh };
}
