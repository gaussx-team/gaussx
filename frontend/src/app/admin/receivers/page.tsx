"use client";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ZoneMap } from "@/components/ZoneMap";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import type { GatewaySetting, GatewayView, StateResponse } from "@/lib/types";

// 비콘 수신기 배치 (⚠️ 잠정 — 백엔드만). 수신기 폰을 실제로 놓은 자리 · 지키는 구역 · 1m 세기를 정한다.
// 헬멧 위치는 수신기 자리를 기준으로 계산하므로, 자리가 실제와 다르면 위치도 그만큼 틀린다.

// 저장 전에 고치는 값 (입력칸 글자 그대로)
interface Draft {
  zoneId: string;
  x: string;
  y: string;
  ref: string; // 비우면 자동
}

const toDraft = (g: GatewaySetting): Draft => ({ zoneId: g.zoneId, x: String(g.x), y: String(g.y), ref: g.ref1mDbm == null ? "" : String(g.ref1mDbm) });
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export default function ReceiversPage() {
  const { data: list, error, refresh } = usePolling<GatewaySetting[]>("/gateways", 2000);
  const { data: state } = usePolling<StateResponse>("/state", 1000);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const zones = state?.zones ?? [];
  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id;
  const draftOf = (g: GatewaySetting) => drafts[g.id] ?? toDraft(g);
  const edit = (g: GatewaySetting, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [g.id]: { ...draftOf(g), ...patch } }));
  const changed = (g: GatewaySetting) => {
    const d = drafts[g.id];
    return !!d && (d.zoneId !== g.zoneId || num(d.x) !== g.x || num(d.y) !== g.y || d.ref.trim() !== toDraft(g).ref);
  };
  // 지도 · 거리에 쓰는 자리: 고치는 중이면 그 값
  const posOf = (g: GatewaySetting) => {
    const d = draftOf(g);
    const x = num(d.x);
    const y = num(d.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: g.x, y: g.y };
  };

  const gws = list ?? [];
  const sel = gws.find((g) => g.id === selected) ?? null;
  const receivers: GatewayView[] = gws.map((g) => ({ id: g.id, zoneId: g.zoneId, label: g.label, ...posOf(g), online: g.online, lastReportAt: g.lastReportAt }));
  const pairs = gws.flatMap((a, i) => gws.slice(i + 1).map((b) => ({ a, b, d: Math.hypot(posOf(a).x - posOf(b).x, posOf(a).y - posOf(b).y) })));

  const finish = (id: string, text: string) => {
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    setMsg({ ok: true, text });
    refresh();
  };
  const run = async (g: GatewaySetting, job: () => Promise<void>) => {
    setBusy(g.id);
    try {
      await job();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "실패했어요" });
    } finally {
      setBusy(null);
    }
  };

  const save = (g: GatewaySetting) => {
    const d = draftOf(g);
    const x = num(d.x);
    const y = num(d.y);
    const ref = d.ref.trim() === "" ? null : Number(d.ref);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return setMsg({ ok: false, text: "자리(x, y)는 숫자(m)로 넣어 주세요" });
    if (ref !== null && !Number.isFinite(ref)) return setMsg({ ok: false, text: "1m 세기는 숫자(dBm)로 넣거나 비워 주세요" });
    // 바꾼 칸만 보낸다 (안 건드린 칸은 씬 값을 그대로 따라가게)
    const body: Record<string, unknown> = { gatewayId: g.id };
    if (d.zoneId !== g.zoneId) body.zoneId = d.zoneId;
    if (x !== g.x || y !== g.y) Object.assign(body, { x, y });
    if (ref !== g.ref1mDbm) body.ref1mDbm = ref;
    return run(g, async () => {
      await api.post<GatewaySetting>("/gateway/settings", body);
      finish(g.id, `${g.label}: 저장했어요 — 바로 쓰고, 백엔드를 다시 켜도 남아요`);
    });
  };
  const reset = (g: GatewaySetting) =>
    run(g, async () => {
      await api.post<GatewaySetting>("/gateway/settings", { gatewayId: g.id, reset: true });
      finish(g.id, `${g.label}: 씬 값으로 되돌렸어요`);
    });
  // 헬멧을 이 수신기 1m 앞에 두고: 지금 세기를 1m 세기로 저장 (고치던 자리 · 구역은 그대로 둔다)
  const calibrate = (g: GatewaySetting) =>
    run(g, async () => {
      const r = await api.post<{ ref1mDbm: number; label: string }>("/gateway/calibrate", { gatewayId: g.id });
      if (drafts[g.id]) edit(g, { ref: String(r.ref1mDbm) });
      setMsg({ ok: true, text: `${g.label}: 1m 세기 ${Math.round(r.ref1mDbm)} dBm 저장 (기준 헬멧: ${r.label})` });
      refresh();
    });

  return (
    <AppShell title="수신기 배치" fill>
      <div className="grid gap-4 lg:h-full lg:grid-cols-[1fr_440px]">
        <section className="card space-y-2 lg:flex lg:min-h-0 lg:flex-col lg:gap-2 lg:space-y-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="shrink-0 font-bold">현장 평면도</h2>
            <span className="text-right text-xs text-slate-500">
              {sel ? `${sel.label} 자리: 지도를 눌러 정해요` : "오른쪽에서 수신기를 고르면 지도를 눌러 자리를 정할 수 있어요"}
            </span>
          </div>
          <div className="lg:min-h-0 lg:flex-1">
            {state ? (
              <ZoneMap
                fit
                zones={zones}
                receivers={receivers}
                helmets={state.presence}
                selectedReceiverId={selected}
                pick={sel ? posOf(sel) : null}
                onPick={sel ? (x, y) => edit(sel, { x: String(x), y: String(y) }) : undefined}
              />
            ) : (
              <p className="py-20 text-center text-slate-500">불러오는 중…</p>
            )}
          </div>
          <p className="text-xs text-slate-500">헬멧 점은 지금 위치예요 (수신기 두 대가 들을 때 · 신호 세기로 어림 ±50%). 수신기 자리를 바꾸면 바로 다시 계산해요.</p>
        </section>

        <section className="card flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
          <div>
            <h2 className="font-bold">비콘 수신기</h2>
            <p className="mt-1 text-xs text-slate-500">
              수신기 폰을 실제로 놓은 자리를 평면도에 맞춰 주세요. 줄자로 잰 수신기 사이 거리가 아래 &lsquo;수신기 사이 거리&rsquo;와 같아야 헬멧 위치가 맞게 나와요.
              저장하면 바로 쓰고, 백엔드를 다시 켜도 남아요.
            </p>
          </div>
          {msg && <p className={`rounded-lg p-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
          {error && !list && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              수신기 설정을 불러오지 못했어요 ({error}). 이 화면은 백엔드가 필요해요 — frontend/.env.local 의 NEXT_PUBLIC_API_BASE_URL 을 확인해 주세요 (목업에는 수신기가 없어요).
            </p>
          )}
          {list && !list.length && <p className="text-sm text-slate-500">씬에 수신기가 없어요 (백엔드 demo.json 의 gateways).</p>}

          <ul className="space-y-3">
            {gws.map((g) => {
              const d = draftOf(g);
              return (
                <li
                  key={g.id}
                  onClick={() => setSelected(g.id)}
                  className={`cursor-pointer rounded-lg border p-3 ${selected === g.id ? "border-blue-600 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{g.label}</b>
                    <span className="font-mono text-xs text-slate-400">{g.id}</span>
                    {g.custom && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">씬 값에서 바꿈</span>}
                    {changed(g) && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">저장 안 함</span>}
                    <span className={`ml-auto text-xs ${g.online ? "text-emerald-600" : "text-slate-400"}`}>
                      {g.online ? "● 연결됨" : "○ 꺼짐"}
                      {g.lastReportAt && ` · ${fmtTime(g.lastReportAt)}`}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div>
                      <label className="label">지키는 구역</label>
                      <select className="input" value={d.zoneId} onChange={(e) => edit(g, { zoneId: e.target.value })}>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">x (m)</label>
                      <input className="input" type="number" step="0.1" value={d.x} onChange={(e) => edit(g, { x: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">y (m)</label>
                      <input className="input" type="number" step="0.1" value={d.y} onChange={(e) => edit(g, { y: e.target.value })} />
                    </div>
                  </div>
                  <div className="mt-2 flex items-end gap-2">
                    <div className="flex-1">
                      <label className="label">1m 세기 (dBm · 비우면 자동)</label>
                      <input className="input" type="number" step="1" placeholder="자동" value={d.ref} onChange={(e) => edit(g, { ref: e.target.value })} />
                    </div>
                    <button
                      className="btn-ghost"
                      disabled={!g.online || busy === g.id}
                      title="헬멧 폰을 이 수신기 1m 앞에 두고 누르세요 (지금 세기를 1m 세기로 저장)"
                      onClick={(e) => {
                        e.stopPropagation();
                        calibrate(g);
                      }}
                    >
                      1m 보정
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="btn-primary flex-1"
                      disabled={!changed(g) || busy === g.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        save(g);
                      }}
                    >
                      저장
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={!g.custom || busy === g.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        reset(g);
                      }}
                    >
                      씬 값으로
                    </button>
                  </div>
                  {g.custom && (
                    <p className="mt-1 text-xs text-slate-400">
                      씬 값: {zoneName(g.defaults.zoneId)} · ({g.defaults.x}, {g.defaults.y}) · 1m {g.defaults.ref1mDbm ?? "자동"}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {pairs.length > 0 && (
            <div>
              <h3 className="label">수신기 사이 거리 (줄자로 잰 값과 같아야 해요)</h3>
              <ul className="space-y-0.5 text-sm">
                {pairs.map(({ a, b, d }) => (
                  <li key={`${a.id}-${b.id}`}>
                    {a.label} ↔ {b.label}: <b>{d.toFixed(2)} m</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
