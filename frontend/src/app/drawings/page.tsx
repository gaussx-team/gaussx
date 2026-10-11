"use client";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { DrawingViewer } from "@/components/DrawingViewer";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { DRAWING_KIND_LABEL, fmtShort } from "@/lib/format";
import type { Drawing, DrawingKind, DrawingsResponse, TagsResponse } from "@/lib/types";

const KINDS = Object.keys(DRAWING_KIND_LABEL) as DrawingKind[];

// 파일을 base64 로 (목업 API 로 보내기 위함)
const toBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = rej;
    r.readAsDataURL(f);
  });

export default function DrawingsPage() {
  const { data, refresh } = usePolling<DrawingsResponse>("/drawings", 5000);
  const { data: tagData } = usePolling<TagsResponse>("/tags", 5000);
  const [selected, setSelected] = useState<number | null>(null);
  const [zone, setZone] = useState("");
  const [kind, setKind] = useState<DrawingKind | "">("");
  const [uploading, setUploading] = useState(false);

  const list = (data?.drawings ?? []).filter((d) => (!zone || d.zoneIds.includes(zone)) && (!kind || d.kind === kind));
  const current = data?.drawings.find((d) => d.id === selected) ?? list[0] ?? null;

  return (
    <AppShell
      title="도면"
      actions={
        <button className="btn-primary" onClick={() => setUploading((u) => !u)}>
          + 도면 등록
        </button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3">
          {uploading && <UploadForm zones={data?.zones ?? []} onDone={(d) => (setUploading(false), refresh(), setSelected(d.id))} />}
          <div className="card space-y-2">
            <div className="flex gap-2">
              <select className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="">모든 구역</option>
                {data?.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as DrawingKind | "")}>
                <option value="">모든 종류</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DRAWING_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <ul className="divide-y divide-slate-100">
              {list.map((d) => (
                <li key={d.id}>
                  <button onClick={() => setSelected(d.id)} className={`w-full rounded px-2 py-2 text-left text-sm ${current?.id === d.id ? "bg-slate-100" : "hover:bg-slate-50"}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{d.title}</span>
                      {d.cad && <span className="rounded bg-slate-200 px-1 text-[10px]">CAD</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {DRAWING_KIND_LABEL[d.kind]} · {d.dwgNo ?? "-"} · {d.revision} · {d.zoneIds.join(", ")}
                    </div>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="py-6 text-center text-sm text-slate-400">도면이 없어요</li>}
            </ul>
          </div>
        </aside>

        <section className="card min-w-0 space-y-3">
          {current ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold">{current.title}</h2>
                <span className="text-xs text-slate-500">
                  {current.dwgNo} · {current.revision} · {current.fileName}
                </span>
                <a href={`/drawing?id=${current.id}`} target="_blank" className="ml-auto text-xs text-blue-600 underline">
                  크게 보기 ↗
                </a>
              </div>
              <DrawingViewer drawing={current} tags={tagData?.tags} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>관련 설비: {current.equipment.join(", ") || "-"}</span>
                <span>
                  등록 {fmtShort(current.uploadedAt)} · {current.uploadedBy}
                </span>
                {current.note && <span>{current.note}</span>}
                {current.mapsToFloor && <span className="text-blue-600">● 위험 태그 위치를 겹쳐 표시 중</span>}
              </div>
            </>
          ) : (
            <p className="py-20 text-center text-slate-400">도면을 골라 주세요</p>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function UploadForm({ zones, onDone }: { zones: { id: string; name: string }[]; onDone: (d: Drawing) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DrawingKind>("floor");
  const [dwgNo, setDwgNo] = useState("");
  const [revision, setRevision] = useState("REV.0");
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [equipment, setEquipment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setErr("파일을 골라 주세요");
    if (file.size > 3 * 1024 * 1024) return setErr("목업은 3MB까지 올릴 수 있어요 (백엔드 연결 후 늘릴 예정)");
    setBusy(true);
    try {
      const d = await api.post<Drawing>("/drawing", {
        title: title || file.name,
        kind,
        dwgNo,
        revision,
        zoneIds,
        equipment: equipment.split(","),
        fileName: file.name,
        mime: file.type || "application/octet-stream",
        dataBase64: await toBase64(file),
      });
      onDone(d);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "실패했어요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-2 text-sm">
      <h3 className="font-bold">도면 등록</h3>
      <input className="input" type="file" accept=".pdf,.svg,.png,.jpg,.jpeg,.dwg,.dxf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <p className="text-xs text-slate-500">PDF·SVG·PNG·JPG 는 바로 볼 수 있어요. DWG·DXF 원본은 내려받기만 돼요.</p>
      <input className="input" placeholder="도면 이름 (비우면 파일 이름)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as DrawingKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {DRAWING_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input className="input" placeholder="도면 번호" value={dwgNo} onChange={(e) => setDwgNo(e.target.value)} />
        <input className="input" placeholder="REV" value={revision} onChange={(e) => setRevision(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {zones.map((z) => (
          <label key={z.id} className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={zoneIds.includes(z.id)} onChange={(e) => setZoneIds((x) => (e.target.checked ? [...x, z.id] : x.filter((i) => i !== z.id)))} />
            {z.name}
          </label>
        ))}
      </div>
      <input className="input" placeholder="관련 설비 번호 (쉼표로: P-203, V-11)" value={equipment} onChange={(e) => setEquipment(e.target.value)} />
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "올리는 중…" : "등록"}
      </button>
      {err && <p className="text-red-600">{err}</p>}
    </form>
  );
}
