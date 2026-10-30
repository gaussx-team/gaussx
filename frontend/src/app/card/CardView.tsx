"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { HoldButton } from "@/components/HoldButton";
import { CardSpace } from "@/components/card3d/CardSpace";
import { useFallDetection } from "@/hooks/useFallDetection";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { drawingMatchesTag, fmtRange, fmtTime, WORK_STATUS_LABEL, workWarnings } from "@/lib/format";
import { EQUIPMENT_STATE_LABEL } from "@/lib/templates";
import type { Alert, CardResponse, CheckItem, Confirmation, Drawing, Tag, Work } from "@/lib/types";

export function CardView() {
  const sp = useSearchParams();
  const workParam = sp.get("work");
  const preview = sp.get("preview") === "1"; // 관리자 미리보기: 읽기 전용, 기록 남기지 않음
  const path = workParam ? `/card?work=${encodeURIComponent(workParam)}` : `/card?device=${encodeURIComponent(sp.get("device") ?? "device-01")}`;
  const { data, error, refresh } = usePolling<CardResponse>(path, 1000);
  const device = data?.work?.deviceId ?? sp.get("device") ?? "device-01";
  const opened = useRef<number | null>(null);

  const work = data?.work ?? null;

  // 카드를 처음 열면 '열람' 기록
  useEffect(() => {
    if (!preview && work && work.status === "published" && opened.current !== work.id) {
      opened.current = work.id;
      api.post("/card/opened", { workId: work.id }).then(refresh).catch(() => {});
    }
  }, [work, refresh, preview]);

  if (preview && data?.work) return <Checklist data={data} device={device} onChange={refresh} readOnly />;

  if (!data) return <Shell device={device} preview={preview}>{error ? <p className="text-red-600">{error}</p> : <p className="text-slate-500">불러오는 중…</p>}</Shell>;

  if (data.alert) return <SosView data={data} device={device} onChange={refresh} />;

  if (!work || work.status === "ended")
    return (
      <Shell device={device}>
        <div className="card py-10 text-center">
          <div className="text-4xl">⏳</div>
          <p className="mt-3 font-bold">{work ? `${work.code} 작업이 끝났어요` : "받은 작업이 없어요"}</p>
          <p className="mt-1 text-sm text-slate-500">담당자가 작업을 보내면 여기에 바로 떠요.</p>
        </div>
      </Shell>
    );

  if (work.status === "cancelled")
    return (
      <Shell device={device}>
        <div className="card py-10 text-center">
          <div className="text-4xl">✕</div>
          <p className="mt-3 font-bold">{work.code} 작업이 취소됐어요</p>
          {work.cancelReason && <p className="mt-1 text-sm text-slate-600">사유: {work.cancelReason}</p>}
          <p className="mt-1 text-sm text-slate-500">담당자가 새 작업을 보내면 여기에 바로 떠요.</p>
        </div>
      </Shell>
    );

  if (work.status !== "confirmed") return <Checklist data={data} device={device} onChange={refresh} />;

  return (
    <Shell device={device}>
      <div className="card space-y-1">
        <div className="text-xs text-slate-500">
          {work.code} · {data.zone?.name}
        </div>
        <div className="text-lg font-bold">{work.title}</div>
        <div className="text-sm text-emerald-700">작업 중 · {fmtTime(work.confirmedAt)} 시작</div>
      </div>
      <PermitNotice work={work} now={data.now} />
      <CardSpace work={work} tags={data.tags} />
      {data.tags.map((t) => (
        <div key={t.id} className="rounded-xl border-l-4 border-red-500 bg-white p-3 text-sm shadow-sm">
          <span className="font-semibold">{t.title}</span> — {t.hazard}
          <DrawingLinks tagTitle={t.title} drawings={data.drawings} />
          {t.status === "superseded" && <div className="mt-1 text-xs text-amber-700">작업 전송 후 이 태그가 수정됐어요 · 담당자에게 최신 내용 확인</div>}
        </div>
      ))}

      <SafetyPanel device={device} onRaised={refresh} />

      <button
        className="btn-ghost w-full py-3"
        onClick={async () => {
          if (!window.confirm("작업을 종료할까요?")) return;
          await api.post("/work/end", { workId: work.id });
          refresh();
        }}
      >
        작업 종료
      </button>
    </Shell>
  );
}

// 작업 중 안전 패널: SOS(3초 길게) + 쓰러짐 자동 감지. 카드 화면과 '내 작업' 목록 둘 다에서 켜져 있어야 한다
export function SafetyPanel({ device, onRaised }: { device: string; onRaised: () => void }) {
  const [autoDetect, setAutoDetect] = useState(true);
  const raise = useCallback(
    async (source: "sos_button" | "accel") => {
      await api.post("/event", { source, deviceId: device }).catch(() => {});
      onRaised();
    },
    [device, onRaised],
  );
  const fall = useFallDetection(autoDetect, () => raise("accel"));

  return (
    <>
      <HoldButton onDone={() => raise("sos_button")}>SOS · 3초 길게 누르기</HoldButton>
      <div className="card space-y-2 text-sm">
        <label className="flex items-center gap-2 font-semibold">
          <input
            type="checkbox"
            checked={autoDetect}
            onChange={async (e) => {
              const on = e.target.checked;
              if (on && !(await fall.requestPermission())) return;
              setAutoDetect(on);
            }}
          />
          쓰러짐 자동 감지 (필수)
        </label>
        <p className="text-xs text-slate-500">
          {fall.status === "on" && "감지 중 — 넘어지면 바로 관제와 로봇에 알려요."}
          {fall.status === "off" && "꺼져 있어요."}
          {fall.status === "needs_permission" && "아직 감지하지 않아요. 아래 버튼을 눌러 센서 권한을 허용해 주세요."}
          {fall.status === "denied" && "센서 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요."}
          {fall.status === "unsupported" && "이 브라우저(또는 http 주소)에서는 센서를 쓸 수 없어요. https 로 열어 주세요."}
        </p>
        {(fall.status === "needs_permission" || fall.status === "denied") && (
          <button className="btn-primary w-full" onClick={async () => (await fall.requestPermission()) && setAutoDetect(true)}>
            센서 권한 허용
          </button>
        )}
      </div>
    </>
  );
}

// 휴대폰: 전체 화면 / 넓은 화면(웹): 가운데 휴대폰 틀 안에 같은 화면 + 옆에 안내
export function Shell({ device, preview = false, back = true, children }: { device: string; preview?: boolean; back?: boolean; children: React.ReactNode }) {
  const body = (
    <div className="mx-auto min-h-full max-w-md space-y-3 p-4 pt-6">
      <div className="flex items-center justify-between text-xs text-slate-500">
        {back && !preview ? (
          <a href={`/card?device=${device}`} className="font-semibold text-slate-700">
            ← 내 작업
          </a>
        ) : (
          <span className="font-bold text-slate-900">GaussX 작업 카드</span>
        )}
        <span className="flex items-center gap-2">
          <span className="font-mono">{device}</span>
          {!preview && (
            <a href="/card?choose=1" className="underline">
              기기 변경
            </a>
          )}
        </span>
      </div>
      {children}
    </div>
  );
  if (preview) return <div className="h-dvh overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{body}</div>;
  return (
    <div className="min-h-dvh lg:flex lg:items-center lg:justify-center lg:gap-12 lg:bg-slate-200 lg:py-8">
      <div className="hidden max-w-xs space-y-3 lg:block">
        <div className="text-2xl font-black">작업자 화면</div>
        <p className="text-sm text-slate-600">현장에서는 작업반장 휴대폰으로 열어요. 웹에서는 같은 화면을 휴대폰 크기로 보여줘요.</p>
        <div className="rounded-lg bg-white p-3 text-xs text-slate-600">
          휴대폰에서 열기
          <div className="mt-1 font-mono text-slate-900">http://노트북IP:3000/card?device={device}</div>
        </div>
        <a href="/control" className="text-sm text-slate-600 underline">
          ← 관제로 돌아가기
        </a>
      </div>
      <div className="lg:h-[760px] lg:w-[380px] lg:shrink-0 lg:overflow-y-auto lg:rounded-[44px] lg:border-[10px] lg:border-slate-900 lg:bg-slate-50 lg:shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{body}</div>
    </div>
  );
}

// 이 설비가 나오는 도면 바로가기 (같은 탭에서 열고 '돌아가기'로 복귀)
function DrawingLinks({ tagTitle, drawings }: { tagTitle: string; drawings: Drawing[] }) {
  const hits = drawings.map((d) => ({ d, code: drawingMatchesTag(d, tagTitle) })).filter((x) => x.code && !x.d.cad);
  if (!hits.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {hits.map(({ d, code }) => (
        <a key={d.id} href={`/drawing?id=${d.id}&eq=${encodeURIComponent(code!)}`} className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700">
          📐 {d.title}
        </a>
      ))}
    </div>
  );
}

// 허가 시간이 지났을 때 (물적 정보만 전달: 시간이 지났다는 사실)
function PermitNotice({ work, now }: { work: Work; now: string }) {
  const permit = workWarnings(work, now).find((x) => x.kind === "permit");
  if (!permit) return null;
  return <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">⏰ 작업 허가 시간이 지났어요 ({permit.text.replace("허가 시간 초과 ", "")} 초과) · 담당자에게 연장 여부를 확인하세요</div>;
}

// 측정 이상이 관제에 전달된 상태
function AbnormalNotice({ list }: { list: Alert[] }) {
  if (!list.length) return null;
  return (
    <div className="space-y-2">
      {list.map((a) => (
        <div key={a.id} className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-bold">측정 이상 · 관제에 전달됐어요</div>
          <div>
            {a.reading?.tagTitle} · {a.reading?.item} <b>{a.reading?.value}{a.reading?.unit}</b> (정상 {a.reading?.range})
          </div>
          {a.reading?.recheckedAt ? (
            <div className="text-xs text-emerald-700">재측정 {a.reading.recheckedValue}{a.reading.unit} 정상 · {fmtTime(a.reading.recheckedAt)}</div>
          ) : (
            <div className="text-xs">다시 측정해 정상이면 진행할 수 있어요.</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── 작업 전 확인 ─────────────────────────────────────────────
function Checklist({ data, device, onChange, readOnly = false }: { data: CardResponse; device: string; onChange: () => void; readOnly?: boolean }) {
  const work = data.work!;
  const [err, setErr] = useState<string | null>(null);
  const done = new Map(data.confirmations.map((c) => [c.checkItemId, c]));
  const items = data.tags.flatMap((t) => t.checkItems);
  const requiredLeft = items.filter((i) => i.required && !done.has(i.id)).length;

  const start = async () => {
    try {
      await api.post("/work/complete", { workId: work.id });
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "실패했어요");
    }
  };

  return (
    <Shell device={device} preview={readOnly}>
      {readOnly && (
        <div className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white">
          미리보기 · {WORK_STATUS_LABEL[work.status]} {data.alert && <span className="ml-1 text-red-300">· 알림 진행 중</span>}
        </div>
      )}
      <div className="card space-y-1">
        <div className="text-xs text-slate-500">
          {work.code} · {data.zone?.name}
        </div>
        <div className="text-lg font-bold">{work.title}</div>
        <div className="text-xs text-slate-500">
          허가 {fmtTime(work.permitStart).slice(0, 5)} ~ {fmtTime(work.permitEnd).slice(0, 5)}
          {work.permitName && <> · 📄 {work.permitName}</>}
        </div>
        {work.checkedInAt && <div className="text-xs text-emerald-700">체크인 {fmtTime(work.checkedInAt)}</div>}
      </div>
      <PermitNotice work={work} now={data.now} />
      <AbnormalNotice list={data.abnormal} />
      <CardSpace work={work} tags={data.tags} />

      {data.tags.map((t) => (
        <TagCard key={t.id} tag={t} workId={work.id} done={done} onChange={onChange} readOnly={readOnly} drawings={data.drawings} />
      ))}

      {!readOnly && <div className="sticky bottom-0 space-y-1 bg-slate-50 pb-2 pt-1">
        <button className="btn-primary w-full py-4 text-base" disabled={requiredLeft > 0} onClick={start}>
          {requiredLeft > 0 ? `필수 항목 ${requiredLeft}개 남음` : "확인 완료 · 작업 시작"}
        </button>
        {err && <p className="text-center text-sm text-red-600">{err}</p>}
      </div>}
    </Shell>
  );
}

function TagCard({ tag, workId, done, onChange, readOnly, drawings }: { tag: Tag; workId: number; done: Map<number, Confirmation>; onChange: () => void; readOnly: boolean; drawings: Drawing[] }) {
  return (
    <div className="card space-y-3">
      {tag.status === "superseded" && <div className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">작업 전송 후 이 태그가 수정됐어요 (지금 보는 건 v{tag.version}) · 담당자에게 최신 내용 확인</div>}
      <div>
        <div className="flex items-center gap-2">
          <span className="font-bold">{tag.title}</span>
          <span className="text-xs text-slate-400">v{tag.version}</span>
          {tag.official ? (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">공식</span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">미검증 · 주의</span>
          )}
        </div>
        <p className="mt-1 text-base font-bold text-red-700">{tag.hazard}</p>
        <p className="text-xs text-slate-500">
          {tag.substance && `${tag.substance} · `}
          {EQUIPMENT_STATE_LABEL[tag.equipmentState]}
        </p>
        <DrawingLinks tagTitle={tag.title} drawings={drawings} />
      </div>
      <ul className="space-y-2">
        {tag.checkItems.map((c) => (
          <CheckRow key={c.id} item={c} workId={workId} done={done.get(c.id)} onChange={onChange} readOnly={readOnly} />
        ))}
      </ul>
    </div>
  );
}

function CheckRow({ item, workId, done, onChange, readOnly }: { item: CheckItem; workId: number; done?: Confirmation; onChange: () => void; readOnly: boolean }) {
  const [value, setValue] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const range = item.needs === "value" && (item.min != null || item.max != null) ? `정상 ${fmtRange(item)}` : null;

  const submit = async () => {
    if (!window.confirm("체크 후에는 수정할 수 없어요. 확인할까요?")) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/confirm", {
        workId,
        checkItemId: item.id,
        value: item.needs === "value" ? (value === "" ? null : Number(value)) : null,
        photo: item.needs === "photo" ? photo : null,
      });
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "실패했어요");
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <li className="flex items-center gap-2 rounded-lg bg-emerald-50 p-2 text-sm">
        <span className="text-emerald-600">✓</span>
        <span>{item.item}</span>
        <span className="ml-auto text-xs text-slate-500">
          {done.value != null && `${done.value}${item.unit ?? ""} · `}
          {done.photo && "사진 · "}
          {fmtTime(done.confirmedAt)}
        </span>
      </li>
    );

  if (readOnly)
    return (
      <li className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-2 text-sm text-slate-500">
        <span>○</span>
        <span>{item.item}</span>
        {item.required && <span className="text-xs text-red-600">필수</span>}
        <span className="ml-auto text-xs">미확인</span>
      </li>
    );

  return (
    <li className="space-y-2 rounded-lg border border-slate-200 p-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{item.item}</span>
        {item.required ? <span className="text-xs text-red-600">필수</span> : <span className="text-xs text-slate-400">선택</span>}
        {range && <span className="ml-auto text-xs text-slate-500">{range}</span>}
      </div>
      {item.needs === "value" && (
        <input className="input" type="number" inputMode="decimal" step="any" placeholder={`측정값${item.unit ? ` (${item.unit})` : ""}`} value={value} onChange={(e) => setValue(e.target.value)} />
      )}
      {item.needs === "photo" && (
        <input className="input" type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0]?.name ?? null)} />
      )}
      <button
        className="btn-primary w-full"
        disabled={busy || (item.needs === "value" && value === "") || (item.needs === "photo" && !photo)}
        onClick={submit}
      >
        확인했어요
      </button>
      {err && <p className="text-red-600">{err}</p>}
    </li>
  );
}

// ── 쓰러짐 / SOS ─────────────────────────────────────────────
function SosView({ data, device, onChange }: { data: CardResponse; device: string; onChange: () => void }) {
  const a = data.alert!;
  const sinceS = (new Date(data.now).getTime() - new Date(a.raisedAt).getTime()) / 1000;
  const canCancel = a.source === "accel" && sinceS <= 10;
  const notes = data.tags.map((t) => t.emergencyNote).filter(Boolean);

  const steps = [
    { label: "알림 접수 · 관제와 로봇에 전달", done: true },
    a.status === "no_robot"
      ? { label: a.humanDispatchedAt ? `안전관리자 출동 ${fmtTime(a.humanDispatchedAt)}` : "로봇이 갈 수 없어 관제가 사람을 보내요", done: !!a.humanDispatchedAt }
      : {
          label: data.robot.state === "moving" ? `로봇 출동 중 · 약 ${data.robot.etaS}초` : a.status === "arrived" ? "로봇 도착" : "로봇 출동",
          done: a.status === "arrived",
        },
    { label: a.acknowledgedAt ? `관제 확인 ${fmtTime(a.acknowledgedAt)}` : "관제 확인 대기", done: !!a.acknowledgedAt },
  ];

  return (
    <Shell device={device}>
      <div className="rounded-2xl bg-red-600 p-5 text-white">
        <div className="text-sm opacity-80">{a.source === "accel" ? "쓰러짐 자동 감지" : "SOS"} · {fmtTime(a.raisedAt)}</div>
        <div className="mt-1 text-2xl font-bold">도움을 부르고 있어요</div>
        <div className="text-sm opacity-90">{a.zoneId ? `${data.zone?.name ?? a.zoneId}` : "구역 불명 — 관제가 위치를 확인해요"}</div>
      </div>
      <ol className="card space-y-2 text-sm">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={s.done ? "text-emerald-600" : "text-slate-300"}>{s.done ? "●" : "○"}</span>
            {s.label}
          </li>
        ))}
      </ol>
      {notes.length > 0 && (
        <div className="card text-sm">
          <div className="mb-1 font-semibold text-red-700">구조자 주의</div>
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
      {canCancel && (
        <button
          className="btn-ghost w-full py-4 text-base"
          onClick={async () => {
            await api.post("/alert/resolve", { alertId: a.id, resolution: "false_alarm" });
            onChange();
          }}
        >
          괜찮아요 (오작동) · {Math.max(0, Math.ceil(10 - sinceS))}초
        </button>
      )}
    </Shell>
  );
}
