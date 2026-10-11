// 목업 서버 저장소 (메모리). NestJS 백엔드가 준비되면 이 폴더와 src/app/api 를 지우고
// .env.local 의 NEXT_PUBLIC_API_BASE_URL 만 백엔드 주소로 바꾼다.
import type {
  Alert,
  AlertSource,
  CardResponse,
  CheckItem,
  Confirmation,
  Dispatch,
  Drawing,
  DrawingsResponse,
  EquipmentState,
  EventLog,
  RobotMode,
  RobotView,
  StateResponse,
  Tag,
  TagsResponse,
  InboxResponse,
  Work,
  EventCategory,
  HistoryEvent,
  HistoryResponse,
  WorkDetailResponse,
  Zone,
  ZoneView,
} from "../types";
import { drawingMatchesTag, eventCategory, fmtRange, inRange, isOpen } from "../format";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// 저장소 모양이 바뀌면 올린다. dev 서버를 켠 채로 코드를 바꿔도 예전 모양 데이터를 쓰지 않게 다시 만든다
const STORE_VERSION = 11;

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
  drawings: Drawing[];
  files: Record<number, { mime: string; data: Buffer; fileName: string }>; // 업로드한 도면 파일 (목업: 메모리)
  seq: { tag: number; check: number; work: number; confirm: number; alert: number; dispatch: number; event: number; drawing: number };
}

const DEVICE = "device-01";
const ROBOT_SPEED = 0.45; // m/s

// 미리 계산한 출동 경로 (precomputed). 바닥 4×3m 기준
const PATHS: Record<string, [number, number][]> = {
  Z1: [[3.3, 2.4], [2.4, 2.0], [1.6, 1.2], [1.0, 0.75]],
  Z2: [[3.3, 2.4], [3.0, 1.6], [3.0, 0.75]],
  Z3: [[3.3, 2.4], [2.2, 2.3], [1.0, 2.25]],
};

const now = () => new Date().toISOString();
// 날짜 계산은 서버 시간대와 상관없이 한국 시간(KST, UTC+9) 기준. 버셀 서버는 UTC라서 로컬 시간을 쓰면 9시간 어긋난다
const KST_MS = 9 * 3600_000;
// KST 날짜 키 YYYY-MM-DD
const dayKey = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
// KST 그날 0시
const startOfDay = (key: string) => new Date(`${key}T00:00:00+09:00`);
// n일 전 KST h시 m분 (과거 이력 시드용, m 이 60을 넘어도 됨)
const daysAgo = (n: number, h: number, m = 0) => new Date(startOfDay(dayKey(new Date())).getTime() - n * 86_400_000 + (h * 60 + m) * 60_000).toISOString();
// 지금 시각의 정시 + n시간
const hourFloor = (plusH: number) => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + plusH);
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
    drawings: [],
    files: {},
    seq: { tag: 0, check: 0, work: 0, confirm: 0, alert: 0, dispatch: 0, event: 0, drawing: 0 },
  };
  const addTag = (t: Omit<Tag, "id" | "status" | "checkItems" | "createdAt" | "version">, checks: Omit<CheckItem, "id" | "tagId" | "seq">[]) => {
    const id = ++s.seq.tag;
    s.tags.push({
      ...t,
      id,
      version: 1,
      replacesId: null,
      status: "active",
      createdAt: daysAgo(8, 9),
      checkItems: checks.map((c, i) => ({ ...c, id: ++s.seq.check, tagId: id, seq: i + 1 })),
    });
    log(s, "tag.created", "원청 안전팀", `${t.title} 태그 생성 (${t.zoneId})`, { at: daysAgo(8, 9) });
    return id;
  };
  const p203 = addTag(
    { zoneId: "Z1", title: "배관 P-203", substance: "불산 55%", hazard: "피부 접촉 시 중증 화상 · 통증이 늦게 나타날 수 있음", emergencyNote: "구조 시 내산 보호구 착용 후 접근", equipmentState: "running", official: true, verifiedBy: "원청 안전팀", x: 1.2, y: 0.45 },
    [
      { item: "배관 잔압 0 확인", needs: "value", unit: "bar", required: true, min: 0, max: 0 },
      { item: "밸브 잠금·표지 부착", needs: "photo", required: true },
      { item: "내산 보호구 착용", needs: "none", required: true },
      { item: "세안·샤워 설비 위치 확인", needs: "none", required: false },
    ],
  );
  const v11 = addTag(
    { zoneId: "Z1", title: "질소 퍼지 밸브 V-11", substance: "질소", hazard: "질소 누출 시 산소 결핍 · 무색·무취라 감지 어려움", emergencyNote: null, equipmentState: "valve_closed", official: true, verifiedBy: "원청 안전팀", x: 0.45, y: 1.1 },
    [{ item: "산소 농도 측정", needs: "value", unit: "%", required: true, min: 18, max: 23.5, maxExclusive: true }],
  );
  addTag(
    { zoneId: "Z2", title: "탱크 T-02", substance: "황산 98%", hazard: "접촉 시 화상 · 물과 섞이면 격렬히 발열", emergencyNote: null, equipmentState: "running", official: false, verifiedBy: null, x: 3.1, y: 0.6 },
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
      { item: "검전기 무전압 확인", needs: "value", unit: "V", required: true, min: 0, max: 0 },
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
  // ── 도면 (public/drawings 의 가상 도면 SVG) ──
  const addDrawing = (d: Omit<Drawing, "id" | "uploadedAt" | "uploadedBy" | "cad" | "mime"> & { mime?: string; cad?: boolean }) =>
    s.drawings.push({ mime: "image/svg+xml", cad: false, ...d, id: ++s.seq.drawing, uploadedAt: daysAgo(8, 10), uploadedBy: "원청 설비팀" });
  addDrawing({ title: "데모 현장 평면도", kind: "floor", dwgNo: "A-101", revision: "REV.B", zoneIds: ["Z1", "Z2", "Z3"], equipment: ["P-203", "V-11", "T-02", "PU-07", "MCC-3", "F-2"], fileName: "A-101_평면도_REV.B.svg", url: "/drawings/floor-plan.svg", mapsToFloor: true, note: "태그 좌표와 같은 축척(4×3m)" });
  addDrawing({ title: "1구역 HF 이송 라인 P&ID", kind: "pid", dwgNo: "P-201", revision: "REV.C", zoneIds: ["Z1"], equipment: ["P-203", "V-11"], fileName: "P-201_HF라인_PID_REV.C.svg", url: "/drawings/pid-z1.svg", mapsToFloor: false, note: "차단 밸브 XV-201, 압력계 PI-203, 드레인 위치 포함" });
  addDrawing({ title: "MCC-3 단선결선도", kind: "electrical", dwgNo: "E-301", revision: "REV.A", zoneIds: ["Z3"], equipment: ["MCC-3", "PU-07", "F-2"], fileName: "E-301_MCC-3_단선도_REV.A.svg", url: "/drawings/sld-mcc3.svg", mapsToFloor: false, note: "주차단기 MCCB-0 · 피더별 차단기" });
  addDrawing({ title: "MCC-3 단선결선도 (CAD 원본)", kind: "electrical", dwgNo: "E-301", revision: "REV.A", zoneIds: ["Z3"], equipment: ["MCC-3"], fileName: "E-301_MCC-3_단선도_REV.A.dwg", url: "/drawings/sld-mcc3.svg", mime: "application/acad", cad: true, mapsToFloor: false, note: "원본 DWG — 내려받아 CAD 프로그램으로 열기 (목업은 SVG로 대체)" });

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
  past({ day: 5, start: [13, 10], end: [17, 0], title: "P-203 배관 누설 점검", zoneId: "Z1", deviceId: "device-02", tagIds: [p203], checks: [{ tagId: p203, n: 0, value: 0 }, { tagId: p203, n: 1, photo: "lock.jpg" }, { tagId: p203, n: 2 }, { tagId: p203, n: 3 }] });
  // 3일 전 오후: P-203 태그 수정(v2). 그 전에 보낸 작업(W-002)은 v1을 그대로 가리킨다
  const p203v2 = reviseTagRow(s, p203, { emergencyNote: "구조자 내산 보호구 필요 · 피부 접촉 시 다량의 물로 세척 후 글루콘산칼슘 겔 (MSDS 확인)" }, daysAgo(3, 17), "원청 안전팀");
  past({ day: 4, start: [10, 20], end: [14, 30], title: "PU-07 펌프 씰 교체", zoneId: "Z2", deviceId: DEVICE, tagIds: [pu07, t02], checks: [{ tagId: pu07, n: 0, photo: "pump.jpg" }, { tagId: pu07, n: 1 }, { tagId: t02, n: 0, photo: "glove.jpg" }], alert: { at: [11, 45], source: "sos_button", resolution: "handled" } });
  past({ day: 3, start: [15, 0], end: [16, 10], title: "F-2 환기팬 지지대 확인", zoneId: "Z3", deviceId: "device-02", tagIds: [f2], checks: [{ tagId: f2, n: 0 }, { tagId: f2, n: 1, photo: "fan.jpg" }] });
  past({ day: 2, start: [10, 0], end: [15, 20], title: "V-11 밸브 패킹 교체", zoneId: "Z1", deviceId: "device-02", tagIds: [v11], checks: [{ tagId: v11, n: 0, value: 20.8 }] });
  past({ day: 1, start: [13, 0], end: [16, 0], title: "T-02 탱크 외부 점검", zoneId: "Z2", deviceId: DEVICE, tagIds: [t02], checks: [{ tagId: t02, n: 0, photo: "glove.jpg" }], alert: { at: [14, 10], source: "accel", resolution: "false_alarm" } });

  // ── 오늘 이미 진행 중인 다른 작업 (단말 2번, 2구역) ──
  {
    const id = ++s.seq.work;
    const code = `W-${String(id).padStart(3, "0")}`;
    const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    const w: Work = { id, code, title: "PU-07 펌프 진동 점검", zoneId: "Z2", deviceId: "device-02", status: "confirmed", tagIds: [pu07], permitName: `작업허가서_${code}.pdf`, permitStart: ago(180), permitEnd: ago(10), publishedAt: ago(50), openedAt: ago(47), checkedInAt: ago(45), confirmedAt: ago(40) };
    s.works.push(w);
    log(s, "work.published", "원청 담당자", `${code} 작업 전송 → device-02`, { workId: id, at: w.publishedAt });
    log(s, "card.opened", "device-02", `${code} 카드 열람`, { workId: id, at: w.openedAt! });
    log(s, "work.checked_in", "작업반장", `${code} 체크인 · Z2`, { workId: id, at: w.checkedInAt! });
    s.tags.find((t) => t.id === pu07)!.checkItems.forEach((it, i) => {
      const at = ago(45 - i * 2);
      s.confirmations.push({ id: ++s.seq.confirm, workId: id, tagId: pu07, checkItemId: it.id, value: null, photo: it.needs === "photo" ? "pump.jpg" : null, deviceId: "device-02", confirmedAt: at });
      log(s, "check.confirmed", "작업반장", `펌프 PU-07 · ${it.item}${it.needs === "photo" ? " · 사진" : ""}`, { workId: id, at });
    });
    log(s, "work.confirmed", "작업반장", `${code} 확인 완료 · 작업 시작`, { workId: id, at: w.confirmedAt! });
  }

  // ── 오늘 같은 단말로 먼저 받은 다른 작업 (작업 목록 · 카드 미확인 경고 확인용) ──
  {
    const id = ++s.seq.work;
    const code = `W-${String(id).padStart(3, "0")}`;
    const at = new Date(Date.now() - 20 * 60000).toISOString();
    s.works.push({ id, code, title: "MCC-3 분전반 차단기 교체", zoneId: "Z3", deviceId: DEVICE, status: "published", tagIds: [mcc3], permitName: `작업허가서_${code}.pdf`, permitStart: hourFloor(0), permitEnd: hourFloor(8), publishedAt: at });
    log(s, "work.published", "원청 담당자", `${code} 작업 전송 → ${DEVICE}`, { workId: id, at });
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
    tagIds: [p203v2, v11],
    permitName: "작업허가서_예시.pdf",
    // 리셋한 시각 기준 정시부터 8시간 (리허설 시간이 언제든 허가 시간 안에 있도록)
    permitStart: hourFloor(0),
    permitEnd: hourFloor(8),
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

// 태그 수정 = 새 버전 줄을 만들고 예전 줄은 superseded 로 보관. 이미 보낸 작업은 예전 id 를 계속 가리킨다
type TagPatch = Partial<Pick<Tag, "zoneId" | "title" | "substance" | "hazard" | "emergencyNote" | "equipmentState" | "official" | "x" | "y">> & { checkItems?: Omit<CheckItem, "id" | "tagId" | "seq">[] };
function reviseTagRow(s: Store, oldId: number, patch: TagPatch, at: string, actor: string) {
  const old = s.tags.find((t) => t.id === oldId);
  if (!old) throw new ApiError(404, "태그를 찾을 수 없어요");
  if (old.status !== "active") throw new ApiError(400, "이미 수정된 예전 버전이에요. 최신 버전에서 수정해 주세요");
  const id = ++s.seq.tag;
  const { checkItems, ...rest } = patch;
  const official = rest.official ?? old.official;
  const next: Tag = {
    ...old,
    ...rest,
    id,
    version: old.version + 1,
    replacesId: old.id,
    status: "active",
    supersededAt: null,
    createdAt: at,
    official,
    verifiedBy: official ? (old.official ? old.verifiedBy : "원청 안전팀") : null,
    verifiedAt: official ? (old.official ? old.verifiedAt : at) : null,
    checkItems: (checkItems ?? old.checkItems).map((c, i) => ({ item: c.item, needs: c.needs, unit: c.unit, required: c.required, min: c.min, max: c.max, maxExclusive: c.maxExclusive, id: ++s.seq.check, tagId: id, seq: i + 1 })),
  };
  old.status = "superseded";
  old.supersededAt = at;
  s.tags.push(next);
  log(s, "tag.revised", actor, `${next.title} v${next.version} 저장 (이전 v${old.version} 보관)`, { at });
  return id;
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
// 단말의 '지금' 작업: 작업 중(confirmed)인 것이 우선, 없으면 가장 최근에 받은 열린 작업
function activeWorkOf(s: Store, deviceId: string) {
  const open = s.works.filter((w) => w.deviceId === deviceId && isOpen(w));
  return open.findLast((w) => w.status === "confirmed") ?? open.at(-1) ?? null;
}

// 작업에 묶인 태그를 작업에 넣은 순서대로
const tagsOf = (s: Store, w: Work) => w.tagIds.map((id) => s.tags.find((t) => t.id === id)).filter((t): t is Tag => !!t);

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
    const working = works.some((w) => w.checkedInAt && isOpen(w));
    const planned = works.some((w) => !w.checkedInAt && isOpen(w));
    const ended = works.length > 0 && works.every((w) => !isOpen(w));
    return {
      ...z,
      workState: working ? "working" : planned ? "planned" : ended ? "ended" : "none",
      alert: openAlerts.some((a) => a.type === "fall" && a.zoneId === z.id),
      warning: openAlerts.some((a) => a.type === "abnormal" && a.zoneId === z.id),
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
  const openFall = (a: Alert) => a.type === "fall" && a.status !== "resolved";
  const alert = work ? (s.alerts.findLast((a) => openFall(a) && a.workId === work.id) ?? s.alerts.findLast((a) => openFall(a) && a.deviceId === work.deviceId) ?? null) : null;
  const abnormal = work ? s.alerts.filter((a) => a.type === "abnormal" && a.status !== "resolved" && a.workId === work.id) : [];
  return {
    now: now(),
    work,
    zone: work ? (s.zones.find((z) => z.id === work.zoneId) ?? null) : null,
    tags: work ? tagsOf(s, work) : [],
    confirmations: work ? s.confirmations.filter((c) => c.workId === work.id) : [],
    alert,
    abnormal,
    robot,
    drawings: work ? drawingsFor(s, work) : [],
  };
}

// 작업의 구역이나 태그 설비 번호에 걸리는 도면
function drawingsFor(s: Store, w: Work) {
  const titles = tagsOf(s, w).map((t) => t.title);
  return s.drawings.filter((d) => d.zoneIds.includes(w.zoneId) || titles.some((t) => drawingMatchesTag(d, t)));
}

export const getDrawings = (): DrawingsResponse => ({ zones: db().zones, drawings: db().drawings });

export function getDrawingFile(id: number) {
  const f = db().files[id];
  if (!f) throw new ApiError(404, "도면 파일을 찾을 수 없어요");
  return f;
}

// 목업은 파일을 메모리에 둔다 (버셀 요청 크기 제한 때문에 3MB까지). 백엔드가 생기면 파일 저장소(S3 등)로
const MAX_DRAWING = 3 * 1024 * 1024;
const CAD_EXT = /\.(dwg|dxf|dgn)$/i;
export function createDrawing(input: { title: string; kind: Drawing["kind"]; dwgNo?: string; revision?: string; zoneIds: string[]; equipment: string[]; fileName: string; mime: string; dataBase64: string; note?: string }) {
  const s = db();
  if (!input.title?.trim()) throw new ApiError(400, "도면 이름을 입력해 주세요");
  if (!input.dataBase64) throw new ApiError(400, "파일을 골라 주세요");
  const data = Buffer.from(input.dataBase64, "base64");
  if (data.length > MAX_DRAWING) throw new ApiError(400, "목업은 3MB까지 올릴 수 있어요");
  const id = ++s.seq.drawing;
  const cad = CAD_EXT.test(input.fileName);
  s.files[id] = { mime: input.mime || "application/octet-stream", data, fileName: input.fileName };
  const d: Drawing = {
    id,
    title: input.title.trim(),
    kind: input.kind,
    dwgNo: input.dwgNo?.trim() || null,
    revision: input.revision?.trim() || "REV.0",
    zoneIds: input.zoneIds ?? [],
    equipment: (input.equipment ?? []).map((e) => e.trim()).filter(Boolean),
    fileName: input.fileName,
    mime: input.mime,
    url: `/api/drawing/file?id=${id}`,
    cad,
    mapsToFloor: false,
    note: input.note?.trim() || null,
    uploadedAt: now(),
    uploadedBy: "담당자",
  };
  s.drawings.push(d);
  log(s, "drawing.uploaded", "담당자", `${d.title} (${d.fileName}) 등록`);
  return d;
}

// 단말의 작업 목록: 열린 작업 전부 + 오늘 끝나거나 취소된 작업
export function getInbox(deviceId: string): InboxResponse {
  const s = db();
  tick(s);
  const today = startOfDay(dayKey(new Date()));
  const doneAt = (w: Work) => w.endedAt ?? w.cancelledAt ?? null;
  const works = s.works
    .filter((w) => w.deviceId === deviceId && (isOpen(w) || (doneAt(w) != null && new Date(doneAt(w)!) >= today)))
    .reverse()
    .map((w) => ({ ...w, ...progress(s, w) }));
  return {
    now: now(),
    deviceId,
    works,
    zones: s.zones,
    alert: s.alerts.findLast((a) => a.type === "fall" && a.status !== "resolved" && a.deviceId === deviceId) ?? null,
  };
}

export function getTags(): TagsResponse {
  const s = db();
  return {
    zones: s.zones,
    tags: s.tags.filter((t) => t.status === "active"),
    history: s.tags.filter((t) => t.status === "superseded"),
    works: s.works.map(({ id, code, tagIds }) => ({ id, code, tagIds })),
  };
}
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
    tags: tagsOf(s, w),
    confirmations: s.confirmations.filter((c) => c.workId === w.id),
    alerts,
    dispatches: s.dispatches.filter((d) => alertIds.has(d.alertId)),
    events: s.events.filter((e) => e.workId === w.id || (e.alertId != null && alertIds.has(e.alertId))).reverse(),
    drawings: drawingsFor(s, w),
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
  if (w.status === "cancelled") throw new ApiError(400, "취소된 작업이에요");
  const tag = s.tags.find((t) => w.tagIds.includes(t.id) && t.checkItems.some((c) => c.id === input.checkItemId));
  const item = tag?.checkItems.find((c) => c.id === input.checkItemId);
  if (!tag || !item) throw new ApiError(400, "이 작업에 없는 확인 항목이에요");
  if (s.confirmations.some((c) => c.workId === w.id && c.checkItemId === item.id)) throw new ApiError(400, "이미 확인한 항목이에요 (수정 불가)");
  if (item.needs === "value") {
    if (input.value === undefined || input.value === null || Number.isNaN(input.value)) throw new ApiError(400, "값이 필요한 항목이에요");
    if (!inRange(item, input.value)) {
      // 이상값은 '확인'으로 저장하지 않고, 측정 이상 알림으로 남겨 관제에 바로 보낸다 (로봇 출동 없음)
      const range = fmtRange(item);
      const value = input.value;
      const shown = `${value}${item.unit ?? ""}`;
      log(s, "check.rejected", "작업반장", `${tag.title} · ${item.item} · ${shown} (정상 ${range})`, { workId: w.id });
      const open = s.alerts.find((a) => a.type === "abnormal" && a.status !== "resolved" && a.workId === w.id && a.reading?.checkItemId === item.id);
      if (open) open.reading = { ...open.reading!, value };
      else {
        const a: Alert = { id: ++s.seq.alert, type: "abnormal", source: "reading", deviceId: w.deviceId, zoneId: w.zoneId, workId: w.id, status: "open", raisedAt: now(), reading: { tagId: tag.id, tagTitle: tag.title, checkItemId: item.id, item: item.item, value, unit: item.unit, range } };
        s.alerts.push(a);
        log(s, "alert.abnormal", "system", `측정 이상 · ${w.zoneId} · ${tag.title} ${item.item} ${shown}`, { alertId: a.id, workId: w.id });
      }
      throw new ApiError(400, `정상 범위(${range})를 벗어났어요. 관제에 자동으로 알렸어요 — 다시 측정해 정상이면 진행할 수 있어요`);
    }
  }
  if (item.needs === "photo" && !input.photo) throw new ApiError(400, "사진이 필요한 항목이에요");

  const first = !s.confirmations.some((c) => c.workId === w.id);
  const c: Confirmation = { id: ++s.seq.confirm, workId: w.id, tagId: tag.id, checkItemId: item.id, value: input.value ?? null, photo: input.photo ?? null, deviceId: w.deviceId, confirmedAt: now() };
  s.confirmations.push(c);
  if (first) {
    w.checkedInAt = c.confirmedAt;
    log(s, "work.checked_in", "작업반장", `${w.code} 체크인 · ${w.zoneId}`, { workId: w.id });
  }
  // 같은 항목에 열린 측정 이상이 있으면 '재측정 정상'으로 표시 (알림 종료는 관제가 판단)
  const abn = s.alerts.find((a) => a.type === "abnormal" && a.status !== "resolved" && a.workId === w.id && a.reading?.checkItemId === item.id);
  if (abn?.reading) abn.reading = { ...abn.reading, recheckedValue: c.value, recheckedAt: c.confirmedAt };
  const val = c.value != null ? ` · ${c.value}${item.unit ?? ""}` : c.photo ? " · 사진" : "";
  log(s, "check.confirmed", "작업반장", `${tag.title} · ${item.item}${val}${abn ? " (재측정)" : ""}`, { workId: w.id });
  return c;
}

export function completeWork(workId: number) {
  const s = db();
  const w = findWork(s, workId);
  if (!isOpen(w)) throw new ApiError(400, "종료되거나 취소된 작업이에요");
  // 한 단말에서 작업 중은 하나만 (쓰러짐 알림이 어느 구역인지 분명하게)
  const other = s.works.find((x) => x.id !== w.id && x.deviceId === w.deviceId && x.status === "confirmed");
  if (other) throw new ApiError(400, `${other.code} 작업이 진행 중이에요. 먼저 종료한 뒤 시작해 주세요`);
  if (progress(s, w).requiredLeft > 0) throw new ApiError(400, "필수 항목을 모두 확인해야 작업을 시작할 수 있어요");
  w.status = "confirmed";
  w.confirmedAt = now();
  log(s, "work.confirmed", "작업반장", `${w.code} 확인 완료 · 작업 시작`, { workId });
  return w;
}

export function endWork(workId: number) {
  const s = db();
  const w = findWork(s, workId);
  if (w.status === "cancelled") throw new ApiError(400, "취소된 작업이에요");
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
  if (input.tagIds.some((id) => s.tags.find((t) => t.id === id)?.status !== "active")) throw new ApiError(400, "수정된 예전 버전 태그가 섞여 있어요. 화면을 새로고침해 주세요");
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
    version: 1,
    replacesId: null,
    status: "active",
    verifiedBy: input.official ? "원청 안전팀" : null,
    verifiedAt: input.official ? now() : null,
    createdAt: now(),
    checkItems: input.checkItems.map((c, i) => ({ ...c, id: ++s.seq.check, tagId: id, seq: i + 1 })),
  };
  s.tags.push(t);
  log(s, "tag.created", "담당자", `${t.title} 태그 생성 (${t.zoneId})`);
  return t;
}

export function reviseTag(tagId: number, patch: TagPatch) {
  const s = db();
  if (patch.title !== undefined && !patch.title.trim()) throw new ApiError(400, "설비 이름은 비울 수 없어요");
  if (patch.hazard !== undefined && !patch.hazard.trim()) throw new ApiError(400, "위험 문구는 비울 수 없어요");
  if (patch.checkItems && !patch.checkItems.length) throw new ApiError(400, "작업 전 확인 항목이 1개 이상 필요해요");
  const id = reviseTagRow(s, tagId, patch, now(), "담당자");
  return s.tags.find((t) => t.id === id)!;
}

export function verifyTag(tagId: number) {
  const s = db();
  const t = s.tags.find((x) => x.id === tagId);
  if (!t) throw new ApiError(404, "태그를 찾을 수 없어요");
  if (t.status !== "active") throw new ApiError(400, "예전 버전은 승인할 수 없어요");
  if (t.official) throw new ApiError(400, "이미 공식 태그예요");
  t.official = true;
  t.verifiedBy = "원청 안전팀";
  t.verifiedAt = now();
  log(s, "tag.verified", "원청 안전팀", `${t.title} 공식 태그로 승인`);
  return t;
}

export function cancelWork(workId: number, reason: string) {
  const s = db();
  const w = findWork(s, workId);
  if (w.status !== "published" && w.status !== "opened") throw new ApiError(400, "작업이 시작된 뒤에는 취소할 수 없어요. 작업 종료로 처리해 주세요");
  if (!reason?.trim()) throw new ApiError(400, "취소 사유를 적어 주세요");
  w.status = "cancelled";
  w.cancelledAt = now();
  w.cancelReason = reason.trim();
  log(s, "work.cancelled", "담당자", `${w.code} 작업 취소 · ${w.cancelReason}`, { workId });
  return w;
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
  // 데모 단순화: 이 알림으로 출동했던 로봇은 대기 위치로 복귀 (측정 이상처럼 출동이 없던 알림은 로봇과 무관)
  const mine = s.dispatches.filter((d) => d.alertId === alertId);
  if (mine.length) {
    mine.filter((d) => d.status === "moving").forEach((d) => (d.status = "arrived"));
    s.robot.x = s.robot.homeX;
    s.robot.y = s.robot.homeY;
  }
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
