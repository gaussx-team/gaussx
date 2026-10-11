"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PhoneFrame } from "@/components/PhoneFrame";
import { StatusBadge } from "@/components/StatusBadge";
import { usePolling } from "@/hooks/usePolling";
import { DRAWING_KIND_LABEL, drawingMatchesTag, EVENT_LABEL, fmtDay, fmtRange, fmtDuration, fmtShort, fmtTime, secondsBetween, SOURCE_LABEL, workWarnings } from "@/lib/format";
import { api } from "@/lib/api";
import { useState } from "react";
import { EQUIPMENT_STATE_LABEL } from "@/lib/templates";
import type { WorkDetailResponse } from "@/lib/types";

export function WorkDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, refresh } = usePolling<WorkDetailResponse>(`/work/${id}`, 1000);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (!data)
    return (
      <AppShell title="작업 등록" crumbs={[{ href: "/admin/works", label: "작업 등록" }]}>
        <p className="text-slate-500">{error ?? "불러오는 중…"}</p>
      </AppShell>
    );

  const w = data.work;
  const done = new Map(data.confirmations.map((c) => [c.checkItemId, c]));

  // 진행 단계: 전송 → 열람 → 체크인 → 작업 시작 → 종료
  const steps = [
    { label: "전송", at: w.publishedAt },
    { label: "카드 열람", at: w.openedAt },
    { label: "체크인", at: w.checkedInAt },
    { label: "작업 시작", at: w.confirmedAt },
    w.status === "cancelled" ? { label: "취소", at: w.cancelledAt } : { label: "종료", at: w.endedAt },
  ];
  const warns = workWarnings(w, data.now);
  const cancellable = w.status === "published" || w.status === "opened";

  const cancel = async () => {
    try {
      await api.post("/work/cancel", { workId: w.id, reason });
      setCancelOpen(false);
      setErr(null);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "실패했어요");
    }
  };

  return (
    <AppShell
      title={`${w.code} · ${w.title}`}
      crumbs={[{ href: "/admin/works", label: "작업 등록" }]}
      actions={
        <>
          <Link href={`/history?work=${w.id}&day=all`} className="btn-ghost">
            이 작업 이력
          </Link>
          <a href={`/card?work=${w.id}&preview=1`} target="_blank" className="btn-ghost">
            카드 새 창 ↗
          </a>
          {cancellable && (
            <button className="btn border border-red-300 bg-white text-red-600 hover:bg-red-50" onClick={() => setCancelOpen((o) => !o)}>
              작업 취소
            </button>
          )}
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          {cancelOpen && (
            <section className="card space-y-2 border-red-200">
              <h2 className="font-bold text-red-700">작업 취소</h2>
              <p className="text-xs text-slate-500">작업 시작 전에만 취소할 수 있어요. 작업자 카드에 취소 사유가 보여요.</p>
              <div className="flex gap-2">
                <input className="input" placeholder="취소 사유 (예: 허가 내용 변경)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button className="btn-danger shrink-0" disabled={!reason.trim()} onClick={cancel}>
                  취소하기
                </button>
              </div>
              {err && <p className="text-sm text-red-600">{err}</p>}
            </section>
          )}
          {warns.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">⚠ {warns.map((x) => x.text).join(" · ")}</div>
          )}
          {/* 작업 정보 */}
          <section className="card">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-bold">작업 정보</h2>
              <StatusBadge status={w.status} />
              <span className="ml-auto text-xs text-slate-400">{fmtDay(w.publishedAt)}</span>
            </div>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Row k="구역" v={data.zone?.name ?? w.zoneId} />
              <Row k="받는 기기" v={<span className="font-mono">{w.deviceId}</span>} />
              <Row k="허가 시간" v={`${fmtTime(w.permitStart).slice(0, 5)} ~ ${fmtTime(w.permitEnd).slice(0, 5)}`} />
              <Row k="작업허가서" v={w.permitName ? `📄 ${w.permitName}` : "없음"} />
              <Row k="위험 태그" v={`${data.tags.length}개`} />
              <Row k="작업 전 확인" v={`${w.done}/${w.total} (필수 ${w.requiredLeft}개 남음)`} />
              {w.status === "cancelled" && <Row k="취소" v={`${fmtShort(w.cancelledAt)} · ${w.cancelReason ?? ""}`} />}
            </dl>
          </section>

          {/* 관련 도면 */}
          {data.drawings.length > 0 && (
            <section className="card">
              <h2 className="mb-2 font-bold">관련 도면</h2>
              <div className="flex flex-wrap gap-2">
                {data.drawings.map((d) => {
                  const code = data.tags.map((t) => drawingMatchesTag(d, t.title)).find(Boolean);
                  return (
                    <a key={d.id} href={`/drawing?id=${d.id}${code ? `&eq=${encodeURIComponent(code)}` : ""}`} target="_blank" className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-slate-400">
                      <div className="font-semibold">📐 {d.title}</div>
                      <div className="text-xs text-slate-500">
                        {DRAWING_KIND_LABEL[d.kind]} · {d.dwgNo} · {d.revision}
                        {d.cad && " · CAD 원본(내려받기)"}
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {/* 진행 단계 */}
          <section className="card">
            <h2 className="mb-3 font-bold">진행</h2>
            <ol className="grid grid-cols-5 gap-1 text-center text-xs">
              {steps.map((s, i) => {
                const prev = steps[i - 1]?.at;
                return (
                  <li key={s.label}>
                    <div className={`mx-auto mb-1 h-2 rounded-full ${s.at ? "bg-blue-600" : "bg-slate-200"}`} />
                    <div className={s.at ? "font-semibold" : "text-slate-400"}>{s.label}</div>
                    <div className="font-mono text-slate-500">{s.at ? fmtTime(s.at).slice(0, 5) : "-"}</div>
                    {s.at && prev && <div className="text-[10px] text-slate-400">+{fmtDuration(secondsBetween(prev, s.at))}</div>}
                  </li>
                );
              })}
            </ol>
          </section>

          {/* 확인 결과 */}
          <section className="card">
            <h2 className="mb-3 font-bold">작업 전 확인 결과</h2>
            <div className="space-y-4">
              {data.tags.map((t) => (
                <div key={t.id}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{t.title}</span>
                    <span className="text-xs text-slate-400">v{t.version}</span>
                    {t.status === "superseded" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">전송 후 수정됨 · 이 작업은 v{t.version} 기준</span>}
                    <span className={`rounded px-1.5 py-0.5 text-xs ${t.official ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{t.official ? "공식" : "미검증"}</span>
                    <span className="text-xs text-slate-500">
                      {t.substance && `${t.substance} · `}
                      {EQUIPMENT_STATE_LABEL[t.equipmentState]}
                    </span>
                  </div>
                  <p className="mb-2 text-sm text-red-700">{t.hazard}</p>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {t.checkItems.map((c) => {
                        const r = done.get(c.id);
                        return (
                          <tr key={c.id}>
                            <td className="w-6 py-1.5">{r ? <span className="text-emerald-600">✓</span> : <span className="text-slate-300">○</span>}</td>
                            <td>
                              {c.item}
                              {c.required && <span className="ml-1 text-xs text-red-600">필수</span>}
                            </td>
                            <td className="text-slate-600">
                              {r?.value != null && `${r.value}${c.unit ?? ""}`}
                              {r?.photo && `📷 ${r.photo}`}
                              {!r && <span className="text-slate-400">미확인</span>}
                              {c.needs === "value" && (c.min != null || c.max != null) && (
                                <span className="ml-1 text-xs text-slate-400">
                                  (정상 {fmtRange(c)})
                                </span>
                              )}
                            </td>
                            <td className="text-right font-mono text-xs text-slate-500">{r ? fmtTime(r.confirmedAt) : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>

          {/* 알림 */}
          {data.alerts.length > 0 && (
            <section className="card">
              <h2 className="mb-2 font-bold">알림</h2>
              <ul className="space-y-2 text-sm">
                {data.alerts.map((a) => {
                  const d = data.dispatches.find((x) => x.alertId === a.id);
                  if (a.type === "abnormal")
                    return (
                      <li key={a.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                        <div className="font-semibold text-amber-800">
                          A-{a.id} · 측정 이상 · {fmtShort(a.raisedAt)}
                        </div>
                        <div className="text-xs text-slate-600">
                          {a.reading?.tagTitle} · {a.reading?.item} {a.reading?.value}
                          {a.reading?.unit} (정상 {a.reading?.range}){a.reading?.recheckedAt ? ` → 재측정 ${a.reading.recheckedValue}${a.reading.unit ?? ""} 정상` : ""} · 관제 확인 {a.acknowledgedAt ? fmtTime(a.acknowledgedAt) : "대기"} · {a.status === "resolved" ? "처리 완료" : "진행 중"}
                        </div>
                      </li>
                    );
                  return (
                    <li key={a.id} className="rounded-lg border border-red-100 bg-red-50/50 p-3">
                      <div className="font-semibold text-red-700">
                        A-{a.id} · {SOURCE_LABEL[a.source]} · {fmtShort(a.raisedAt)}
                      </div>
                      <div className="text-xs text-slate-600">
                        로봇 {d ? `${d.durationS.toFixed(1)}초 이동 (${d.status === "arrived" ? "도착" : "이동 중"})` : `출동 불가(${a.robotUnavailable ?? "-"})${a.humanDispatchedAt ? ` · 사람 출동 ${fmtTime(a.humanDispatchedAt)}` : ""}`} · 관제 확인{" "}
                        {a.acknowledgedAt ? fmtTime(a.acknowledgedAt) : "대기"} · 결과 {a.resolution === "false_alarm" ? "오탐 해제" : a.resolution === "handled" ? "처리 완료" : "진행 중"}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* 이 작업의 기록 */}
          <section className="card">
            <h2 className="mb-2 font-bold">기록</h2>
            <ol className="space-y-1 text-sm">
              {data.events.map((e) => (
                <li key={e.seq} className="flex gap-3">
                  <span className="shrink-0 font-mono text-xs text-slate-400">{fmtShort(e.at)}</span>
                  <span className="shrink-0 font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span>
                  <span className="text-slate-600">{e.text}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400">{e.actor}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* 작업자가 보는 화면 그대로 (읽기 전용) */}
        <aside className="space-y-2 xl:sticky xl:top-4 xl:self-start">
          <div className="text-center text-xs text-slate-500">작업자 휴대폰 화면 (미리보기 · 조작 불가)</div>
          <PhoneFrame>
            <iframe title="작업 카드 미리보기" src={`/card?work=${w.id}&preview=1`} className="h-full w-full" />
          </PhoneFrame>
        </aside>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-slate-500">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
