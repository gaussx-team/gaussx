// 목업 서버 저장소 (메모리). NestJS 백엔드가 준비되면 이 폴더와 src/app/api 를 지우고
// .env.local 의 NEXT_PUBLIC_API_BASE_URL 만 백엔드 주소로 바꾼다.
import type {
  Alert,
  AlertSource,
  CardResponse,
  CheckItem,
  Confirmation,
  Dispatch,
  EquipmentState,
  EventLog,
  RobotMode,
  RobotView,
  StateResponse,
  Tag,
  Work,
  EventCategory,
  HistoryEvent,
  HistoryResponse,
  WorkDetailResponse,
  Zone,
  ZoneView,
} from "../types";
import { eventCategory } from "../format";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// 저장소 모양이 바뀌면 올린다. dev 서버를 켠 채로 코드를 바꿔도 예전 모양 데이터를 쓰지 않게 다시 만든다
const STORE_VERSION = 6;

interface Store {
  version: number;
  zones: Zone[];
  tags: Tag[];
  works: Work[];
  confirmations: Confirmation[];
  alerts: Alert[];
  dispatches: Dispatch[];
  events: EventLog[];
  robot: { homeX: number; homeY: number; x: number; y: number; mode: RobotMode; battery: number };
  seq: { tag: number; check: number; work: number; confirm: number; alert: number; dispatch: number; event: number };
}

const DEVICE = "helmet-01";
const ROBOT_SPEED = 0.45; // m/s

// 미리 계산한 출동 경로 (precomputed). 바닥 4×3m 기준
const PATHS: Record<string, [number, number][]> = {
  Z1: [[3.3, 2.4], [2.4, 2.0], [1.6, 1.2], [1.0, 0.75]],
  Z2: [[3.3, 2.4], [3.0, 1.6], [3.0, 0.75]],
  Z3: [[3.3, 2.4], [2.2, 2.3], [1.0, 2.25]],
};

const now = () => new Date().toISOString();
// n일 전 h시 m분 (과거 이력 시드용, 서버 로컬 시간 기준)
const daysAgo = (n: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
// 서버 로컬 날짜 키 YYYY-MM-DD
const dayKey = (d: Date) => d.toLocaleDateString("sv-SE");
const startOfDay = (key: string) => new Date(`${key}T00:00:00`);
const todayAt = (h: number, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

function seed(): Store {
  const s: Store = {
    version: STORE_VERSION,
    zones: [
      { id: "Z1", name: "1구역 · 배관", rect: [0, 0, 2, 1.5] },
      { id: "Z2", name: "2구역 · 탱크", rect: [2, 0, 2, 1.5] },
      { id: "Z3", name: "3구역 · 전기실", rect: [0, 1.5, 2, 1.5] },
    ],
    tags: [],
    works: [],
    confirmations: [],
    alerts: [],
    dispatches: [],
    events: [],
    robot: { homeX: 3.3, homeY: 2.4, x: 3.3, y: 2.4, mode: "ready", battery: 82 },
    seq: { tag: 0, check: 0, work: 0, confirm: 0, alert: 0, dispatch: 0, event: 0 },
  };
  const addTag = (t: Omit<Tag, "id" | "status" | "checkItems" | "createdAt">, checks: Omit<CheckItem, "id" | "tagId" | "seq">[]) => {
    const id = ++s.seq.tag;
    s.tags.push({
      ...t,
      id,
      status: "active",
      createdAt: daysAgo(8, 9),
      checkItems: checks.map((c, i) => ({ ...c, id: ++s.seq.check, tagId: id, seq: i + 1 })),
    });
    log(s, "tag.created", "원청 안전팀", `${t.title} 태그 생성 (${t.zoneId})`, { at: daysAgo(8, 9) });
    return id;
  };
  const p203 = addTag(
    { zoneId: "Z1", title: "배관 P-203", substance: "불산 55%", hazard: "피부 접촉 시 중증 화상 · 보호구 없이 접근 금지", emergencyNote: "구조 시 내산 보호구 착용 후 접근", equipmentState: "running", official: true, verifiedBy: "원청 안전팀", x: 1.2, y: 0.45 },
    [
      { item: "배관 잔압 0 확인", needs: "value", unit: "bar", required: true, min: 0, max: 0 },
      { item: "밸브 잠금·표지 부착", needs: "photo", required: true },
      { item: "내산 보호구 착용", needs: "none", required: true },
      { item: "세안·샤워 설비 위치 확인", needs: "none", required: false },
    ],
  );
  const v11 = addTag(
    { zoneId: "Z1", title: "밸브 V-11", substance: "질소", hazard: "밀폐 공간 질식 — 산소 농도 측정 후 진입", emergencyNote: null, equipmentState: "valve_closed", official: true, verifiedBy: "원청 안전팀", x: 0.45, y: 1.1 },
    [{ item: "산소 농도 측정", needs: "value", unit: "%", required: true, min: 18, max: 23.5 }],
  );
  addTag(
    { zoneId: "Z2", title: "탱크 T-02", substance: "황산 98%", hazard: "접촉 시 화상 · 하부 밸브 개방 금지", emergencyNote: null, equipmentState: "running", official: false, verifiedBy: null, x: 3.1, y: 0.6 },
    [{ item: "내산 장갑 착용", needs: "photo", required: true }],
  );
  const t02 = s.tags[2].id;
  const pu07 = addTag(
    { zoneId: "Z2", title: "펌프 PU-07", substance: "황산 이송", hazard: "회전부 끼임 · 정지·잠금 후 접근", emergencyNote: "구조 전 펌프 전원 차단 확인", equipmentState: "running", official: true, verifiedBy: "원청 안전팀", x: 2.5, y: 1.1 },
    [
      { item: "펌프 정지·전원 차단", needs: "photo", required: true },
      { item: "회전부 완전 정지 확인", needs: "none", required: true },
    ],
  );
  const mcc3 = addTag(
    { zoneId: "Z3", title: "분전반 MCC-3", substance: null, hazard: "감전 위험 · 차단·검전 후 작업", emergencyNote: "구조 시 주차단기 OFF 먼저", equipmentState: "running", official: true, verifiedBy: "원청 안전팀", x: 0.5, y: 2.0 },
    [
      { item: "차단기 OFF·잠금 표지", needs: "photo", required: true },
      { item: "검전기 측정 (무전압)", needs: "value", unit: "V", required: true, min: 0, max: 0 },
      { item: "절연 장갑 착용", needs: "none", required: true },
    ],
  );
  const f2 = addTag(
    { zoneId: "Z3", title: "환기팬 F-2 지지대", substance: null, hazard: "노후 지지대 · 하부 출입 통제", emergencyNote: null, equipmentState: "deteriorated", official: false, verifiedBy: null, x: 1.5, y: 2.6 },
    [
      { item: "하부 출입 통제", needs: "none", required: true },
      { item: "지지대 상태 사진", needs: "photo", required: false },
    ],
  );
  const item = (tagId: number, n: number) => s.tags.find((t) => t.id === tagId)!.checkItems[n];

  // ── 지난 작업 (일주일치 · 이력·날짜 필터 확인용) ──
  const past = (o: { day: number; start: [number, number]; end: [number, number]; title: string; zoneId: string; deviceId: string; tagIds: number[]; checks: { tagId: number; n: number; value?: number; photo?: string }[]; alert?: { at: [number, number]; source: AlertSource; resolution: "handled" | "false_alarm" } }) => {
    const id = ++s.seq.work;
    const code = `W-${String(id).padStart(3, "0")}`;
    const t = (h: number, m: number) => daysAgo(o.day, h, m);
    const [h, m] = o.start;
    const w: Work = { id, code, title: o.title, zoneId: o.zoneId, deviceId: o.deviceId, status: "ended", tagIds: o.tagIds, permitName: `작업허가서_${code}.pdf`, permitStart: t(h, 0), permitEnd: t(o.end[0] + 1, 0), publishedAt: t(h, m), openedAt: t(h, m + 3), checkedInAt: t(h, m + 5), confirmedAt: t(h, m + 5 + o.checks.length * 2), endedAt: t(...o.end) };
    s.works.push(w);
    log(s, "work.published", "원청 담당자", `${code} 작업 전송 → ${o.deviceId}`, { workId: id, at: w.publishedAt });
    log(s, "card.opened", o.deviceId, `${code} 카드 열람`, { workId: id, at: w.openedAt! });
    log(s, "work.checked_in", "작업반장", `${code} 체크인 · ${o.zoneId}`, { workId: id, at: w.checkedInAt! });
    o.checks.forEach((c, i) => {
      const it = item(c.tagId, c.n);
      const at = t(h, m + 5 + i * 2);
      s.confirmations.push({ id: ++s.seq.confirm, workId: id, tagId: c.tagId, checkItemId: it.id, value: c.value ?? null, photo: c.photo ?? null, deviceId: o.deviceId, confirmedAt: at });
      const val = c.value != null ? ` · ${c.value}${it.unit ?? ""}` : c.photo ? " · 사진" : "";
      log(s, "check.confirmed", "작업반장", `${s.tags.find((x) => x.id === c.tagId)!.title} · ${it.item}${val}`, { workId: id, at });
    });
    log(s, "work.confirmed", "작업반장", `${code} 확인 완료 · 작업 시작`, { workId: id, at: w.confirmedAt! });
    if (o.alert) {
      const [ah, am] = o.alert.at;
      const aid = ++s.seq.alert;
      const resolvedAt = t(ah, am + (o.alert.resolution === "false_alarm" ? 0 : 6));
      const path = PATHS[o.zoneId];
      const durationS = pathLength(path) / ROBOT_SPEED;
      const raisedAt = t(ah, am);
      const arrivedAt = new Date(new Date(raisedAt).getTime() + durationS * 1000).toISOString();
      const ackAt = t(ah, am + 1);
      s.alerts.push({ id: aid, type: "fall", source: o.alert.source, deviceId: o.deviceId, zoneId: o.zoneId, workId: id, status: "resolved", raisedAt, acknowledgedAt: o.alert.resolution === "handled" ? ackAt : raisedAt, resolvedAt, resolution: o.alert.resolution });
      s.dispatches.push({ id: ++s.seq.dispatch, alertId: aid, goalZoneId: o.zoneId, computed: "precomputed", path, durationS, startedAt: raisedAt, endedAt: arrivedAt, status: "arrived" });
      log(s, "alert.raised", o.deviceId, `쓰러짐 · ${o.zoneId} · ${o.alert.source}`, { alertId: aid, workId: id, at: raisedAt });
      log(s, "dispatch.started", "system", `로봇 출동 → ${o.zoneId} (미리 계산한 경로)`, { alertId: aid, at: raisedAt });
      log(s, "dispatch.arrived", "system", `로봇 ${o.zoneId} 도착 (${durationS.toFixed(1)}초)`, { alertId: aid, at: arrivedAt });
      if (o.alert.resolution === "handled") log(s, "alert.acknowledged", "관제", `알림 A-${aid} 관제 확인`, { alertId: aid, at: ackAt });
      log(s, "alert.resolved", "작업반장", `알림 A-${aid} ${o.alert.resolution === "false_alarm" ? "오탐 해제" : "처리 완료"}`, { alertId: aid, at: resolvedAt });
    }
    log(s, "work.ended", "작업반장", `${code} 작업 종료`, { workId: id, at: w.endedAt! });
  };
  past({ day: 6, start: [9, 30], end: [11, 40], title: "MCC-3 분전반 정기 점검", zoneId: "Z3", deviceId: DEVICE, tagIds: [mcc3], checks: [{ tagId: mcc3, n: 0, photo: "breaker.jpg" }, { tagId: mcc3, n: 1, value: 0 }, { tagId: mcc3, n: 2 }] });
  past({ day: 5, start: [13, 10], end: [17, 0], title: "P-203 배관 누설 점검", zoneId: "Z1", deviceId: "helmet-02", tagIds: [p203], checks: [{ tagId: p203, n: 0, value: 0 }, { tagId: p203, n: 1, photo: "lock.jpg" }, { tagId: p203, n: 2 }, { tagId: p203, n: 3 }] });
  past({ day: 4, start: [10, 20], end: [14, 30], title: "PU-07 펌프 씰 교체", zoneId: "Z2", deviceId: DEVICE, tagIds: [pu07, t02], checks: [{ tagId: pu07, n: 0, photo: "pump.jpg" }, { tagId: pu07, n: 1 }, { tagId: t02, n: 0, photo: "glove.jpg" }], alert: { at: [11, 45], source: "sos_button", resolution: "handled" } });
  past({ day: 3, start: [15, 0], end: [16, 10], title: "F-2 환기팬 지지대 확인", zoneId: "Z3", deviceId: "helmet-02", tagIds: [f2], checks: [{ tagId: f2, n: 0 }, { tagId: f2, n: 1, photo: "fan.jpg" }] });
  past({ day: 2, start: [10, 0], end: [15, 20], title: "V-11 밸브 패킹 교체", zoneId: "Z1", deviceId: "helmet-02", tagIds: [v11], checks: [{ tagId: v11, n: 0, value: 20.8 }] });
  past({ day: 1, start: [13, 0], end: [16, 0], title: "T-02 탱크 외부 점검", zoneId: "Z2", deviceId: DEVICE, tagIds: [t02], checks: [{ tagId: t02, n: 0, photo: "glove.jpg" }], alert: { at: [14, 10], source: "accel", resolution: "false_alarm" } });

  // ── 오늘 이미 진행 중인 다른 작업 (헬멧 2번, 2구역) ──
  {
    const id = ++s.seq.work;
    const code = `W-${String(id).padStart(3, "0")}`;
    const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    const w: Work = { id, code, title: "PU-07 펌프 진동 점검", zoneId: "Z2", deviceId: "helmet-02", status: "confirmed", tagIds: [pu07], permitName: `작업허가서_${code}.pdf`, permitStart: todayAt(8), permitEnd: todayAt(17), publishedAt: ago(50), openedAt: ago(47), checkedInAt: ago(45), confirmedAt: ago(40) };
    s.works.push(w);
    log(s, "work.published", "원청 담당자", `${code} 작업 전송 → helmet-02`, { workId: id, at: w.publishedAt });
    log(s, "card.opened", "helmet-02", `${code} 카드 열람`, { workId: id, at: w.openedAt! });
    log(s, "work.checked_in", "작업반장", `${code} 체크인 · Z2`, { workId: id, at: w.checkedInAt! });
    s.tags.find((t) => t.id === pu07)!.checkItems.forEach((it, i) => {
      const at = ago(45 - i * 2);
      s.confirmations.push({ id: ++s.seq.confirm, workId: id, tagId: pu07, checkItemId: it.id, value: null, photo: it.needs === "photo" ? "pump.jpg" : null, deviceId: "helmet-02", confirmedAt: at });
      log(s, "check.confirmed", "작업반장", `펌프 PU-07 · ${it.item}${it.needs === "photo" ? " · 사진" : ""}`, { workId: id, at });
    });
    log(s, "work.confirmed", "작업반장", `${code} 확인 완료 · 작업 시작`, { workId: id, at: w.confirmedAt! });
  }

  // ── 오늘 시연할 작업 ──
  const id = ++s.seq.work;
  const code = `W-${String(id).padStart(3, "0")}`;
  s.works.push({
    id,
    code,
    title: "P-203 배관 플랜지 교체",
    zoneId: "Z1",
    deviceId: DEVICE,
    status: "published",
    tagIds: [p203, v11],
    permitName: "작업허가서_예시.pdf",
    permitStart: todayAt(9),
    permitEnd: todayAt(18),
    publishedAt: now(),
  });
  log(s, "work.published", "원청 담당자", `${code} 작업 전송 → ${DEVICE}`, { workId: id });
  return s;
}

declare global {
  var __gaussxStore: Store | undefined;
}

function db(): Store {
  if (globalThis.__gaussxStore?.version !== STORE_VERSION) globalThis.__gaussxStore = seed();
  return globalThis.__gaussxStore;
}

function log(s: Store, type: string, actor: string, text: string, ref: Partial<EventLog> = {}) {
  s.events.push({ seq: ++s.seq.event, at: now(), type, actor, text, ...ref });
}

// ── 로봇: 경과 시간으로 위치를 계산하고, 끝나면 도착 처리 ──────────
function pathLength(p: [number, number][]) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

function pointAt(p: [number, number][], frac: number): [number, number] {
  let target = pathLength(p) * frac;
  for (let i = 1; i < p.length; i++) {
    const seg = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (target <= seg) {
      const t = seg === 0 ? 0 : target / seg;
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
    }
    target -= seg;
  }
  return p[p.length - 1];
}

function tick(s: Store): RobotView {
  const d = s.dispatches.findLast((x) => x.status === "moving");
  if (!d) {
    const last = s.dispatches.at(-1);
    const arrived = last?.status === "arrived" && s.alerts.find((a) => a.id === last.alertId)?.status === "arrived";
    return { ...robotBase(s), x: s.robot.x, y: s.robot.y, state: arrived ? "arrived" : "idle", etaS: null };
  }
  const elapsed = (Date.now() - new Date(d.startedAt).getTime()) / 1000;
  if (elapsed >= d.durationS) {
    const [x, y] = d.path[d.path.length - 1];
    d.status = "arrived";
    d.endedAt = now();
    s.robot.x = x;
    s.robot.y = y;
    const a = s.alerts.find((al) => al.id === d.alertId);
    if (a && a.status === "dispatched") a.status = "arrived";
    log(s, "dispatch.arrived", "system", `로봇 ${d.goalZoneId} 도착 (${d.durationS.toFixed(1)}초)`, { alertId: d.alertId });
    return { ...robotBase(s), x, y, state: "arrived", etaS: 0 };
  }
  const [x, y] = pointAt(d.path, elapsed / d.durationS);
  return { ...robotBase(s), available: false, x, y, state: "moving", etaS: Math.ceil(d.durationS - elapsed) };
}

function robotBase(s: Store) {
  const busy = s.dispatches.some((d) => d.status === "moving");
  return { mode: s.robot.mode, battery: s.robot.battery, available: s.robot.mode === "ready" && !busy };
}

const MODE_REASON: Record<RobotMode, string> = { ready: "", charging: "충전 중", maintenance: "점검 중", offline: "연결 끊김" };


// ── 조회 ────────────────────────────────────────────────────────
function activeWorkOf(s: Store, deviceId: string) {
  return s.works.findLast((w) => w.deviceId === deviceId && w.status !== "ended") ?? null;
}

function progress(s: Store, w: Work) {
  const items = s.tags.filter((t) => w.tagIds.includes(t.id)).flatMap((t) => t.checkItems);
  const done = s.confirmations.filter((c) => c.workId === w.id);
  const doneIds = new Set(done.map((c) => c.checkItemId));
  return {
    done: done.length,
    total: items.length,
    requiredLeft: items.filter((i) => i.required && !doneIds.has(i.id)).length,
  };
}

export function getState(): StateResponse {
  const s = db();
  const robot = tick(s);
  const openAlerts = s.alerts.filter((a) => a.status !== "resolved");
  const zones: ZoneView[] = s.zones.map((z) => {
    const works = s.works.filter((w) => w.zoneId === z.id);
    const working = works.some((w) => w.checkedInAt && w.status !== "ended");
    const planned = works.some((w) => !w.checkedInAt && w.status !== "ended");
    const ended = works.length > 0 && works.every((w) => w.status === "ended");
    return {
      ...z,
      workState: working ? "working" : planned ? "planned" : ended ? "ended" : "none",
      alert: openAlerts.some((a) => a.zoneId === z.id),
    };
  });
  return {
    now: now(),
    zones,
    works: s.works.map((w) => ({ ...w, ...progress(s, w) })),
    tags: s.tags.filter((t) => t.status === "active"),
    alerts: [...s.alerts].reverse().slice(0, 10),
    dispatch: s.dispatches.at(-1) ?? null,
    robot,
    // 관제 타임라인은 오늘 것만
    events: s.events.filter((e) => new Date(e.at) >= startOfDay(dayKey(new Date()))).reverse().slice(0, 30),
  };
}

// 기기로 찾으면 그 기기의 최근 작업, workId 로 찾으면 그 작업 (관리자 미리보기용)
export function getCard(q: { deviceId?: string | null; workId?: number | null }): CardResponse {
  const s = db();
  const robot = tick(s);
  const work = q.workId ? findWork(s, q.workId) : (s.works.findLast((w) => w.deviceId === q.deviceId) ?? null);
  const alert = work ? (s.alerts.findLast((a) => a.workId === work.id && a.status !== "resolved") ?? s.alerts.findLast((a) => a.deviceId === work.deviceId && a.status !== "resolved") ?? null) : null;
  return {
    now: now(),
    work,
    zone: work ? (s.zones.find((z) => z.id === work.zoneId) ?? null) : null,
    tags: work ? s.tags.filter((t) => work.tagIds.includes(t.id)) : [],
    confirmations: work ? s.confirmations.filter((c) => c.workId === work.id) : [],
    alert,
    robot,
  };
}

export const getTags = () => ({ zones: db().zones, tags: db().tags.filter((t) => t.status === "active") });
export function getWorkDetail(workId: number): WorkDetailResponse {
  const s = db();
  tick(s);
  const w = findWork(s, workId);
  const alerts = s.alerts.filter((a) => a.workId === w.id);
  const alertIds = new Set(alerts.map((a) => a.id));
  return {
    now: now(),
    work: { ...w, ...progress(s, w) },
    zone: s.zones.find((z) => z.id === w.zoneId) ?? null,
    tags: s.tags.filter((t) => w.tagIds.includes(t.id)),
    confirmations: s.confirmations.filter((c) => c.workId === w.id),
    alerts,
    dispatches: s.dispatches.filter((d) => alertIds.has(d.alertId)),
    events: s.events.filter((e) => e.workId === w.id || (e.alertId != null && alertIds.has(e.alertId))).reverse(),
  };
}

// 이력 조회: day = YYYY-MM-DD | "today" | "all", 종류·구역·작업·검색어로 거르기
export function getHistory(f: { day?: string | null; categories?: EventCategory[]; zoneId?: string | null; workId?: number | null; q?: string | null }): HistoryResponse {
  const s = db();
  const day = !f.day || f.day === "today" ? dayKey(new Date()) : f.day;
  const from = day === "all" ? null : startOfDay(day);
  const to = from ? new Date(from.getTime() + 86_400_000) : null;
  const q = f.q?.trim().toLowerCase();

  const rows: HistoryEvent[] = s.events.map((e) => {
    const w = e.workId != null ? s.works.find((x) => x.id === e.workId) : null;
    const a = e.alertId != null ? s.alerts.find((x) => x.id === e.alertId) : null;
    const workId = e.workId ?? a?.workId ?? null;
    return { ...e, workId, category: eventCategory(e.type), zoneId: w?.zoneId ?? a?.zoneId ?? null, workCode: s.works.find((x) => x.id === workId)?.code ?? null };
  });
  const events = rows
    .filter((e) => !from || (new Date(e.at) >= from && new Date(e.at) < to!))
    .filter((e) => !f.categories?.length || f.categories.includes(e.category))
    .filter((e) => !f.zoneId || e.zoneId === f.zoneId)
    .filter((e) => !f.workId || e.workId === f.workId)
    .filter((e) => !q || `${e.text} ${e.actor} ${e.workCode ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.seq - a.seq));

  return {
    now: now(),
    day,
    today: dayKey(new Date()),
    events,
    works: s.works.map(({ id, code, title }) => ({ id, code, title })),
    zones: s.zones,
  };
}

// ── 쓰기 ────────────────────────────────────────────────────────
function findWork(s: Store, workId: number) {
  const w = s.works.find((x) => x.id === workId);
  if (!w) throw new ApiError(404, "작업을 찾을 수 없어요");
  return w;
}

export function openCard(workId: number) {
  const s = db();
  const w = findWork(s, workId);
  if (w.status === "published") {
    w.status = "opened";
    w.openedAt = now();
  }
  log(s, "card.opened", w.deviceId, `${w.code} 카드 열람`, { workId });
  return w;
}

export function confirm(input: { workId: number; checkItemId: number; value?: number | null; photo?: string | null }) {
  const s = db();
  const w = findWork(s, input.workId);
  if (w.status === "ended") throw new ApiError(400, "이미 종료된 작업이에요");
  const tag = s.tags.find((t) => w.tagIds.includes(t.id) && t.checkItems.some((c) => c.id === input.checkItemId));
  const item = tag?.checkItems.find((c) => c.id === input.checkItemId);
  if (!tag || !item) throw new ApiError(400, "이 작업에 없는 확인 항목이에요");
  if (s.confirmations.some((c) => c.workId === w.id && c.checkItemId === item.id)) throw new ApiError(400, "이미 확인한 항목이에요 (수정 불가)");
  if (item.needs === "value") {
    if (input.value === undefined || input.value === null || Number.isNaN(input.value)) throw new ApiError(400, "값이 필요한 항목이에요");
    const outMin = item.min != null && input.value < item.min;
    const outMax = item.max != null && input.value > item.max;
    if (outMin || outMax) throw new ApiError(400, `정상 범위(${item.min ?? "-"}~${item.max ?? "-"}${item.unit ?? ""})를 벗어났어요. 작업을 시작하지 말고 관제에 알려주세요`);
  }
  if (item.needs === "photo" && !input.photo) throw new ApiError(400, "사진이 필요한 항목이에요");

  const first = !s.confirmations.some((c) => c.workId === w.id);
  const c: Confirmation = { id: ++s.seq.confirm, workId: w.id, tagId: tag.id, checkItemId: item.id, value: input.value ?? null, photo: input.photo ?? null, deviceId: w.deviceId, confirmedAt: now() };
  s.confirmations.push(c);
  if (first) {
    w.checkedInAt = c.confirmedAt;
    log(s, "work.checked_in", "작업반장", `${w.code} 체크인 · ${w.zoneId}`, { workId: w.id });
  }
  const val = c.value != null ? ` · ${c.value}${item.unit ?? ""}` : c.photo ? " · 사진" : "";
  log(s, "check.confirmed", "작업반장", `${tag.title} · ${item.item}${val}`, { workId: w.id });
  return c;
}

export function completeWork(workId: number) {
  const s = db();
  const w = findWork(s, workId);
  if (progress(s, w).requiredLeft > 0) throw new ApiError(400, "필수 항목을 모두 확인해야 작업을 시작할 수 있어요");
  w.status = "confirmed";
  w.confirmedAt = now();
  log(s, "work.confirmed", "작업반장", `${w.code} 확인 완료 · 작업 시작`, { workId });
  return w;
}

export function endWork(workId: number) {
  const s = db();
  const w = findWork(s, workId);
  w.status = "ended";
  w.endedAt = now();
  log(s, "work.ended", "작업반장", `${w.code} 작업 종료`, { workId });
  return w;
}

export function createWork(input: { title: string; zoneId: string; deviceId: string; tagIds: number[]; permitName?: string | null; permitStart?: string | null; permitEnd?: string | null }) {
  const s = db();
  if (!input.title?.trim()) throw new ApiError(400, "작업명을 입력해 주세요");
  if (!s.zones.some((z) => z.id === input.zoneId)) throw new ApiError(400, "구역을 선택해 주세요");
  if (!input.tagIds?.length) throw new ApiError(400, "태그를 1개 이상 묶어 주세요");
  const id = ++s.seq.work;
  const w: Work = { ...input, id, code: `W-${String(id).padStart(3, "0")}`, status: "published", publishedAt: now() };
  s.works.push(w);
  log(s, "work.published", "담당자", `${w.code} 작업 전송 → ${w.deviceId}`, { workId: id });
  return w;
}

export function createTag(input: { zoneId: string; title: string; substance?: string; hazard: string; emergencyNote?: string; equipmentState: EquipmentState; official: boolean; x: number; y: number; checkItems: Omit<CheckItem, "id" | "tagId" | "seq">[] }) {
  const s = db();
  if (!input.title?.trim() || !input.hazard?.trim()) throw new ApiError(400, "설비 이름과 위험 문구는 필수예요");
  if (!input.checkItems?.length) throw new ApiError(400, "작업 전 확인 항목이 1개 이상 필요해요");
  const id = ++s.seq.tag;
  const t: Tag = {
    ...input,
    id,
    status: "active",
    verifiedBy: input.official ? "원청 안전팀" : null,
    createdAt: now(),
    checkItems: input.checkItems.map((c, i) => ({ ...c, id: ++s.seq.check, tagId: id, seq: i + 1 })),
  };
  s.tags.push(t);
  log(s, "tag.created", "담당자", `${t.title} 태그 생성 (${t.zoneId})`);
  return t;
}

export function raiseFall(input: { source: AlertSource; deviceId?: string | null; zoneId?: string | null }) {
  const s = db();
  // 구역 결정: 직접 지정 → 기기의 진행 중 작업 구역(체크인) → 불명
  const work = input.deviceId ? activeWorkOf(s, input.deviceId) : null;
  const zoneId = input.zoneId ?? work?.zoneId ?? null;
  const a: Alert = { id: ++s.seq.alert, type: "fall", source: input.source, deviceId: input.deviceId ?? null, zoneId, workId: work?.id ?? null, status: "dispatched", raisedAt: now() };
  s.alerts.push(a);
  log(s, "alert.raised", input.deviceId ?? "관제", `쓰러짐 · ${zoneId ?? "구역 불명"} · ${input.source}`, { alertId: a.id, workId: a.workId });
  // 로봇이 못 가면 출동 없이 '사람 출동 필요'로 남긴다 (관제가 판단)
  const robot = tick(s);
  const reason = !zoneId ? "구역 불명" : s.robot.mode !== "ready" ? MODE_REASON[s.robot.mode] : !robot.available ? "다른 알림에 출동 중" : null;
  if (reason || !zoneId) {
    a.status = "no_robot";
    a.robotUnavailable = reason;
    log(s, "dispatch.unavailable", "system", `로봇 출동 불가 (${reason}) — 사람 출동 필요`, { alertId: a.id, workId: a.workId });
    return a;
  }
  // 알림과 동시에 자동 출동 (관제 확인을 기다리지 않음)
  // 대기 위치에서 출발하면 미리 계산한 경로, 이미 밖에 나가 있으면 목표 지점으로 직행
  const atHome = s.robot.x === s.robot.homeX && s.robot.y === s.robot.homeY;
  const goal = PATHS[zoneId].at(-1)!;
  const path: [number, number][] = atHome ? PATHS[zoneId] : [[s.robot.x, s.robot.y], goal];
  const d: Dispatch = { id: ++s.seq.dispatch, alertId: a.id, goalZoneId: zoneId, computed: "precomputed", path, durationS: pathLength(path) / ROBOT_SPEED, startedAt: now(), status: "moving" };
  s.dispatches.push(d);
  log(s, "dispatch.started", "system", `로봇 출동 → ${zoneId} (미리 계산한 경로)`, { alertId: a.id });
  return a;
}

export function acknowledge(alertId: number) {
  const s = db();
  const a = s.alerts.find((x) => x.id === alertId);
  if (!a) throw new ApiError(404, "알림을 찾을 수 없어요");
  a.acknowledgedAt ??= now();
  log(s, "alert.acknowledged", "관제", `알림 A-${alertId} 관제 확인`, { alertId });
  return a;
}

export function resolve(alertId: number, resolution: "handled" | "false_alarm") {
  const s = db();
  const a = s.alerts.find((x) => x.id === alertId);
  if (!a) throw new ApiError(404, "알림을 찾을 수 없어요");
  a.status = "resolved";
  a.resolvedAt = now();
  a.resolution = resolution;
  s.dispatches.filter((d) => d.alertId === alertId && d.status === "moving").forEach((d) => (d.status = "arrived"));
  // 데모 단순화: 알림이 끝나면 로봇은 대기 위치로 복귀
  s.robot.x = s.robot.homeX;
  s.robot.y = s.robot.homeY;
  log(s, "alert.resolved", resolution === "false_alarm" ? "작업반장/관제" : "관제", `알림 A-${alertId} ${resolution === "false_alarm" ? "오탐 해제" : "처리 완료"}`, { alertId });
  return a;
}

export function dispatchHuman(alertId: number) {
  const s = db();
  const a = s.alerts.find((x) => x.id === alertId);
  if (!a) throw new ApiError(404, "알림을 찾을 수 없어요");
  if (a.humanDispatchedAt) throw new ApiError(400, "이미 사람 출동을 지시했어요");
  a.humanDispatchedAt = now();
  a.acknowledgedAt ??= a.humanDispatchedAt;
  log(s, "dispatch.human", "관제", `알림 A-${alertId} 안전관리자 출동 지시`, { alertId, workId: a.workId });
  return a;
}

export function setRobotMode(mode: RobotMode) {
  const s = db();
  if (!(mode in MODE_REASON)) throw new ApiError(400, "알 수 없는 로봇 상태예요");
  s.robot.mode = mode;
  log(s, "robot.mode", "관리자", `로봇 상태 → ${mode === "ready" ? "출동 대기" : MODE_REASON[mode]}`);
  return robotBase(s);
}

export function reset() {
  globalThis.__gaussxStore = seed();
  log(db(), "session.reset", "system", "데모 리셋");
}
