"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { usePolling } from "@/hooks/usePolling";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { DEVICES, saveDevice, savedDevice } from "@/lib/devices";
import { fmtTime, isOpen, workWarnings } from "@/lib/format";
import type { InboxResponse, StateResponse, WorkView } from "@/lib/types";
import { CardView, SafetyPanel, Shell } from "./CardView";

// /card                       → 이 휴대폰에 기억된 단말로 이동, 없으면 단말 선택
// /card?device=…              → 그 단말이 받은 작업 목록
// /card?device=…&work=…       → 작업 카드 하나
// /card?work=…&preview=1      → 관리자 미리보기 (읽기 전용)
// /card?choose=1              → 단말 다시 고르기
export function CardEntry() {
  const sp = useSearchParams();
  const device = sp.get("device");
  const choose = sp.get("choose") === "1";
  if (choose) return <DevicePicker auto={false} />;
  if (sp.get("work")) return <CardView />;
  if (device) return <Inbox device={device} />;
  return <DevicePicker auto />;
}

// 내 작업 목록: 한 사람이 하루에 여러 작업을 받을 수 있다
function Inbox({ device }: { device: string }) {
  const { data, error, refresh } = usePolling<InboxResponse>(`/inbox?device=${encodeURIComponent(device)}`, 1500);
  const label = DEVICES.find((d) => d.id === device)?.label ?? device;
  const open = data?.works.filter(isOpen) ?? [];
  const done = data?.works.filter((w) => !isOpen(w)) ?? [];
  // 작업 중인 것 → 확인 중 → 아직 안 연 것 순서
  const rank = (w: WorkView) => (w.status === "confirmed" ? 0 : w.checkedInAt ? 1 : w.status === "opened" ? 2 : 3);
  open.sort((a, b) => rank(a) - rank(b));

  return (
    <Shell device={device} back={false}>
      <div>
        <h1 className="text-xl font-black">내 작업</h1>
        <p className="text-xs text-slate-500">
          {label} · 오늘 받은 작업 {data?.works.length ?? 0}건
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data?.alert && (
        <Link href={`/card?device=${device}&work=${data.alert.workId ?? open[0]?.id ?? ""}`} className="block rounded-2xl bg-red-600 p-4 font-bold text-white">
          SOS 진행 중 · 눌러서 상태 보기 →
        </Link>
      )}
      {/* 작업 중인 작업이 있으면 목록에서도 SOS·자동 감지가 켜져 있어야 한다 */}
      {data && !data.alert && open.some((w) => w.status === "confirmed") && <SafetyPanel device={device} onRaised={refresh} />}
      {data && open.length === 0 && (
        <div className="card py-10 text-center">
          <div className="text-4xl">⏳</div>
          <p className="mt-3 font-bold">지금 받은 작업이 없어요</p>
          <p className="mt-1 text-sm text-slate-500">담당자가 작업을 보내면 여기에 바로 떠요.</p>
        </div>
      )}
      <ul className="space-y-2">
        {open.map((w) => (
          <li key={w.id}>
            <WorkRow w={w} device={device} zone={data?.zones.find((z) => z.id === w.zoneId)?.name} now={data!.now} />
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="text-xs font-semibold text-slate-500">오늘 끝난 작업</div>
          {done.map((w) => (
            <WorkRow key={w.id} w={w} device={device} zone={data?.zones.find((z) => z.id === w.zoneId)?.name} now={data!.now} />
          ))}
        </div>
      )}
    </Shell>
  );
}

function WorkRow({ w, device, zone, now }: { w: WorkView; device: string; zone?: string; now: string }) {
  const warns = workWarnings(w, now);
  const next = w.status === "confirmed" ? "작업 중 · SOS" : w.checkedInAt ? `확인 중 · 필수 ${w.requiredLeft}개 남음` : isOpen(w) ? "눌러서 작업 전 확인 시작" : "";
  return (
    <Link href={`/card?device=${device}&work=${w.id}`} className={`card block hover:border-slate-400 ${w.status === "confirmed" ? "border-blue-300 bg-blue-50" : ""} ${!isOpen(w) ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="font-mono">{w.code}</span>
        <span>{zone}</span>
        <span className="ml-auto">
          <StatusBadge status={w.status} />
        </span>
      </div>
      <div className="mt-1 font-bold">{w.title}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        <span>
          허가 {fmtTime(w.permitStart).slice(0, 5)}~{fmtTime(w.permitEnd).slice(0, 5)}
        </span>
        <span className="ml-auto">
          확인 {w.done}/{w.total}
        </span>
      </div>
      {next && <div className="mt-1 text-sm font-semibold text-slate-700">{next} →</div>}
      {warns.map((x) => (
        <div key={x.kind} className="mt-1 text-xs font-semibold text-amber-700">
          ⚠ {x.text}
        </div>
      ))}
      {w.status === "cancelled" && w.cancelReason && <div className="mt-1 text-xs text-slate-500">취소 사유: {w.cancelReason}</div>}
    </Link>
  );
}

function DevicePicker({ auto }: { auto: boolean }) {
  const router = useRouter();
  const { data } = usePolling<StateResponse>("/state", 3000);

  // 전에 고른 기기가 있으면 바로 그 카드로
  useEffect(() => {
    if (!auto) return;
    const d = savedDevice();
    if (d) router.replace(`/card?device=${d}`);
  }, [auto, router]);

  const pick = (id: string) => {
    saveDevice(id);
    router.replace(`/card?device=${id}`);
  };

  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-4 p-6">
      <div>
        <div className="text-xs font-bold text-slate-500">GaussX 작업 카드</div>
        <h1 className="mt-1 text-2xl font-black">이 휴대폰은 어느 단말인가요?</h1>
        <p className="mt-1 text-sm text-slate-600">한 번 고르면 다음부터 바로 이 기기의 작업 카드가 열려요. 로그인은 없어요.</p>
      </div>
      <ul className="space-y-2">
        {DEVICES.map((d) => {
          const open = data?.works.filter((x) => x.deviceId === d.id && isOpen(x)) ?? [];
          return (
            <li key={d.id}>
              <button onClick={() => pick(d.id)} className="card flex w-full items-center gap-3 text-left hover:border-slate-400">
                <span className="text-3xl">📱</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{d.label}</span>
                  <span className="block font-mono text-xs text-slate-400">{d.id}</span>
                </span>
                <span className="text-right text-xs text-slate-500">
                  {open.length ? `받은 작업 ${open.length}건` : "받은 작업 없음"}
                  {open.some((x) => x.status === "confirmed") && <span className="block">작업 중 1건</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-400">현장에서는 작업반장 휴대폰마다 한 번 등록해 두고, 찍으면 그 기기 주소로 바로 열리게 할 수 있어요.</p>
    </div>
  );
}
