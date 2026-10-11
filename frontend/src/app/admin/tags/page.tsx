"use client";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ZoneMap } from "@/components/ZoneMap";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { fmtShort, NEEDS_LABEL } from "@/lib/format";
import { EQUIPMENT_STATE_LABEL, TEMPLATES, type TemplateCheck } from "@/lib/templates";
import type { EquipmentState, Needs, Tag, TagsResponse, Zone } from "@/lib/types";

const EMPTY = {
  zoneId: "Z1",
  title: "",
  substance: "",
  hazard: "",
  emergencyNote: "",
  equipmentState: "running" as EquipmentState,
  official: true,
};

// 구역 사각형 안의 점인지 → 지도 클릭 위치로 구역 자동 선택
const zoneAt = (zones: Zone[], x: number, y: number) =>
  zones.find(({ rect: [zx, zy, w, h] }) => x >= zx && x <= zx + w && y >= zy && y <= zy + h)?.id;

export default function TagsPage() {
  const { data, refresh } = usePolling<TagsResponse>("/tags", 3000);
  const [form, setForm] = useState(EMPTY);
  const [pick, setPick] = useState<{ x: number; y: number } | null>(null);
  const [checks, setChecks] = useState<TemplateCheck[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Tag | null>(null); // 수정 중인 태그 (저장하면 새 버전)
  const [openHistory, setOpenHistory] = useState<number | null>(null);

  const zones = data?.zones ?? [];
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setCheck = (i: number, patch: Partial<TemplateCheck>) =>
    setChecks((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (t) setChecks(t.checks.map((c) => ({ ...c })));
  };

  // 이전 버전 목록 (replacesId 를 따라 거슬러 올라감)
  const versionsOf = (t: Tag) => {
    const out: Tag[] = [];
    let cur = data?.history.find((h) => h.id === t.replacesId);
    while (cur) {
      out.push(cur);
      const prev: number | null | undefined = cur.replacesId;
      cur = data?.history.find((h) => h.id === prev);
    }
    return out;
  };
  const usedBy = (tagId: number) => data?.works.filter((w) => w.tagIds.includes(tagId)).map((w) => w.code) ?? [];

  const startEdit = (t: Tag) => {
    setEditing(t);
    setForm({ zoneId: t.zoneId, title: t.title, substance: t.substance ?? "", hazard: t.hazard, emergencyNote: t.emergencyNote ?? "", equipmentState: t.equipmentState, official: t.official });
    setChecks(t.checkItems.map(({ item, needs, unit, required, min, max, maxExclusive }) => ({ item, needs, unit, required, min, max, maxExclusive })));
    setPick({ x: t.x, y: t.y });
    setMsg(null);
  };
  const resetForm = () => {
    setEditing(null);
    setForm({ ...EMPTY, zoneId: form.zoneId });
    setChecks([]);
    setPick(null);
  };

  const verify = async (t: Tag) => {
    if (!window.confirm(`${t.title} 을(를) 공식 태그로 승인할까요?`)) return;
    await api.post("/tag/verify", { tagId: t.id }).catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : "실패했어요" }));
    refresh();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pick) return setMsg({ ok: false, text: "평면도에서 설비 위치를 눌러 주세요" });
    try {
      const body = { ...form, x: pick.x, y: pick.y, checkItems: checks.filter((c) => c.item.trim()) };
      const t = editing ? await api.post<Tag>("/tag/revise", { tagId: editing.id, patch: body }) : await api.post<Tag>("/tag", body);
      setMsg({ ok: true, text: editing ? `${t.title} v${t.version}로 저장했어요 (이전 버전은 기록으로 남아요)` : `${t.title} 태그를 만들었어요` });
      resetForm();
      refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "실패했어요" });
    }
  };

  return (
    <AppShell title="위험 태그">
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <section className="space-y-3">
          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">현장 평면도</h2>
              <span className="text-xs text-slate-500">3D 스캔 뷰어 자리 (연동 전 2D) · 클릭해서 위치 지정</span>
            </div>
            <ZoneMap
              zones={zones}
              tags={data?.tags}
              pick={pick}
              onPick={(x, y) => {
                setPick({ x, y });
                const z = zoneAt(zones, x, y);
                if (z) set("zoneId", z);
              }}
            />
          </div>
          <div className="card">
            <h2 className="mb-2 font-bold">등록된 태그 {data?.tags.length ?? 0}개</h2>
            <ul className="divide-y divide-slate-100">
              {data?.tags.map((t) => {
                const versions = versionsOf(t);
                return (
                  <li key={t.id} className={`py-2 text-sm ${editing?.id === t.id ? "bg-blue-50" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t.title}</span>
                      <span className="text-xs text-slate-400">v{t.version}</span>
                      <span className="text-slate-500">{t.zoneId}</span>
                      <span className={`ml-auto rounded px-1.5 py-0.5 text-xs ${t.official ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {t.official ? "공식" : "미검증"}
                      </span>
                      {!t.official && (
                        <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => verify(t)}>
                          승인
                        </button>
                      )}
                      <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => startEdit(t)}>
                        수정
                      </button>
                    </div>
                    <div className="text-slate-600">{t.hazard}</div>
                    <div className="text-xs text-slate-400">
                      {EQUIPMENT_STATE_LABEL[t.equipmentState]} · 확인 항목 {t.checkItems.length}개 (필수 {t.checkItems.filter((c) => c.required).length})
                      {t.verifiedAt && ` · 승인 ${fmtShort(t.verifiedAt)}`}
                      {versions.length > 0 && (
                        <button className="ml-2 text-blue-600 underline" onClick={() => setOpenHistory(openHistory === t.id ? null : t.id)}>
                          이전 버전 {versions.length}개
                        </button>
                      )}
                    </div>
                    {openHistory === t.id && (
                      <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
                        {versions.map((v) => (
                          <li key={v.id}>
                            <span className="font-semibold">v{v.version}</span> · {fmtShort(v.createdAt)} ~ {fmtShort(v.supersededAt)}
                            <div className="text-slate-600">위험: {v.hazard}</div>
                            {v.emergencyNote && <div className="text-slate-600">구조자 주의: {v.emergencyNote}</div>}
                            <div className="text-slate-400">이 버전을 쓴 작업: {usedBy(v.id).join(", ") || "없음"}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <form onSubmit={submit} className="card space-y-3 self-start">
          <div className="flex items-center">
            <h2 className="font-bold">{editing ? `${editing.title} 수정 → v${editing.version + 1}` : "새 태그"}</h2>
            {editing && (
              <button type="button" className="ml-auto text-xs text-slate-500 underline" onClick={resetForm}>
                수정 취소
              </button>
            )}
          </div>
          {editing && <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-800">저장하면 새 버전이 생기고, 지금 버전(v{editing.version})은 기록으로 남아요. 이미 보낸 작업은 예전 버전 그대로 보여요.</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">구역</label>
              <select className="input" value={form.zoneId} onChange={(e) => set("zoneId", e.target.value)}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">위치 (m)</label>
              <div className="input text-slate-500">{pick ? `${pick.x}, ${pick.y}` : "지도를 눌러 주세요"}</div>
            </div>
          </div>
          <div>
            <label className="label">설비 이름 (번호 포함)</label>
            <input className="input" placeholder="배관 P-204" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">물질</label>
              <input className="input" placeholder="불산 55%" value={form.substance} onChange={(e) => set("substance", e.target.value)} />
            </div>
            <div>
              <label className="label">설비 상태</label>
              <select className="input" value={form.equipmentState} onChange={(e) => set("equipmentState", e.target.value as EquipmentState)}>
                {Object.entries(EQUIPMENT_STATE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">위험 문구 (카드에 크게 표시)</label>
            <input className="input" placeholder="피부 접촉 시 중증 화상" value={form.hazard} onChange={(e) => set("hazard", e.target.value)} />
          </div>
          <div>
            <label className="label">사고 시 구조자 주의</label>
            <input className="input" placeholder="내산 보호구 착용 후 접근" value={form.emergencyNote} onChange={(e) => set("emergencyNote", e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.official} onChange={(e) => set("official", e.target.checked)} />
            원청 안전팀 검증 완료 (공식 태그)
          </label>

          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">작업 전 확인 항목</span>
              <select className="input ml-auto w-auto" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="" disabled>
                  위험 유형 템플릿
                </option>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            {checks.map((c, i) => (
              <div key={i} className="space-y-1 rounded-lg border border-slate-200 bg-white p-2">
                <div className="flex gap-1">
                  <input className="input" value={c.item} onChange={(e) => setCheck(i, { item: e.target.value })} />
                  <button type="button" className="btn-ghost" onClick={() => setChecks((cs) => cs.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select className="input w-auto py-1" value={c.needs} onChange={(e) => setCheck(i, { needs: e.target.value as Needs })}>
                    {Object.entries(NEEDS_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {c.needs === "value" && (
                    <>
                      <input className="input w-16 py-1" placeholder="최소" type="number" step="any" value={c.min ?? ""} onChange={(e) => setCheck(i, { min: e.target.value === "" ? null : Number(e.target.value) })} />
                      ~
                      <input className="input w-16 py-1" placeholder="최대" type="number" step="any" value={c.max ?? ""} onChange={(e) => setCheck(i, { max: e.target.value === "" ? null : Number(e.target.value) })} />
                      <input className="input w-16 py-1" placeholder="단위" value={c.unit ?? ""} onChange={(e) => setCheck(i, { unit: e.target.value })} />
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={!!c.maxExclusive} onChange={(e) => setCheck(i, { maxExclusive: e.target.checked })} />
                        최대 미만
                      </label>
                    </>
                  )}
                  <label className="ml-auto flex items-center gap-1">
                    <input type="checkbox" checked={c.required} onChange={(e) => setCheck(i, { required: e.target.checked })} />
                    필수
                  </label>
                </div>
              </div>
            ))}
            <button type="button" className="btn-ghost w-full" onClick={() => setChecks((cs) => [...cs, { item: "", needs: "none", required: true }])}>
              + 항목 직접 추가
            </button>
          </div>

          <button className="btn-primary w-full">{editing ? `v${editing.version + 1}로 저장` : "태그 만들기"}</button>
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
        </form>
      </div>
    </AppShell>
  );
}
