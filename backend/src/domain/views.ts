// DB 행 → API 모양. 이름 · 모양은 frontend/src/lib/types.ts 와 같다 (camelCase). 바꾸면 docs/api.md 도 함께.
import { placeholders, type Queryable } from '../db/db.js';
import type { AlertSource, Needs, RobotMode, WorkStatus } from './rules.js';
import { fmtRange, isOpen } from './rules.js';

export interface CheckItemDto {
  id: number;
  tagId: number;
  seq: number;
  item: string;
  needs: Needs;
  unit: string | null;
  required: boolean;
  min: number | null;
  max: number | null;
  maxExclusive: boolean;
}

export interface TagDto {
  id: number;
  siteId: string;
  zoneId: string;
  title: string;
  substance: string | null;
  hazard: string;
  emergencyNote: string | null;
  equipmentState: string;
  official: boolean;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  version: number;
  replacesId: number | null;
  supersededAt: Date | null;
  x: number;
  y: number;
  z: number | null;
  status: 'active' | 'superseded';
  checkItems: CheckItemDto[];
  createdBy: string;
  createdAt: Date;
}

export interface ZoneDto {
  id: string;
  siteId: string;
  name: string;
  color: string | null;
  rect: [number, number, number, number] | null;
}

export interface WorkDto {
  id: number;
  code: string;
  siteId: string;
  title: string;
  zoneId: string;
  deviceId: string;
  status: WorkStatus;
  tagIds: number[];
  permitName: string | null;
  permitFileUrl: string | null;
  permitUrl: string | null;
  permitStart: Date | null;
  permitEnd: Date | null;
  publishedBy: string;
  publishedAt: Date;
  openedAt: Date | null;
  checkedInAt: Date | null;
  confirmedAt: Date | null;
  endedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  // 진행 (WorkView)
  done: number;
  total: number;
  requiredLeft: number;
}

export interface ConfirmationDto {
  id: number;
  workId: number;
  tagId: number;
  checkItemId: number;
  value: number | null;
  /** 사진 주소 (파일을 올렸을 때) 또는 파일 이름 */
  photo: string | null;
  deviceId: string | null;
  confirmedBy: string;
  confirmedAt: Date;
}

export interface ReadingDto {
  tagId: number;
  tagTitle: string;
  checkItemId: number;
  item: string;
  value: number;
  unit: string | null;
  range: string;
  recheckedValue: number | null;
  recheckedAt: Date | null;
}

export interface AlertDto {
  id: number;
  siteId: string;
  type: 'fall' | 'abnormal';
  source: AlertSource;
  deviceId: string | null;
  zoneId: string | null;
  workId: number | null;
  status: 'dispatched' | 'arrived' | 'no_robot' | 'open' | 'resolved';
  raisedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  resolution: 'handled' | 'false_alarm' | null;
  robotUnavailable: string | null;
  humanDispatchedAt: Date | null;
  reading: ReadingDto | null;
  confidence: number | null;
}

export interface DispatchDto {
  id: number;
  alertId: number;
  goalZoneId: string;
  computed: 'live' | 'precomputed';
  path: [number, number][];
  durationS: number;
  startedAt: Date;
  endedAt: Date | null;
  status: 'planning' | 'moving' | 'arrived' | 'failed' | 'cancelled';
}

export interface EventDto {
  seq: number;
  at: Date;
  type: string;
  actor: string;
  text: string;
  workId: number | null;
  alertId: number | null;
  tagId: number | null;
  dispatchId: number | null;
  drawingId: number | null;
  deviceId: string | null;
}

export interface DrawingDto {
  id: number;
  siteId: string;
  title: string;
  kind: 'floor' | 'pid' | 'electrical' | 'other';
  dwgNo: string | null;
  revision: string;
  zoneIds: string[];
  equipment: string[];
  fileName: string;
  mime: string;
  url: string;
  cad: boolean;
  mapsToFloor: boolean;
  note: string | null;
  uploadedAt: Date;
  uploadedBy: string;
}

export interface RobotDto {
  id: string;
  x: number;
  y: number;
  yaw: number;
  home: [number, number];
  state: 'idle' | 'moving' | 'arrived';
  etaS: number | null;
  mode: RobotMode;
  battery: number;
  /** 지금 알림이 오면 바로 출동할 수 있는지 */
  available: boolean;
}

/** 파일 주소. base = 백엔드 주소 (프론트가 다른 주소에서 돌기 때문에 절대 주소로 준다) */
export const fileUrl = (base: string, path: string) => `${base}/media/${path}`;

// ── 읽기 ────────────────────────────────────────────────────────

/** 다각형 → 화면의 사각형 [x, y, w, h] (외접 사각형) */
export function rectOf(polygon: unknown): [number, number, number, number] | null {
  if (!Array.isArray(polygon) || !polygon.length) return null;
  const xs = polygon.map((p) => Number((p as number[])[0]));
  const ys = polygon.map((p) => Number((p as number[])[1]));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

export async function loadZones(q: Queryable): Promise<ZoneDto[]> {
  const rows = await q.query<{ id: string; site_id: string; name: string; color: string | null; polygon: unknown }>(
    'SELECT id, site_id, name, color, polygon FROM zone ORDER BY sort, id',
  );
  return rows.map((r) => ({ id: r.id, siteId: r.site_id, name: r.name, color: r.color, rect: rectOf(r.polygon) }));
}

interface TagRow {
  id: number;
  site_id: string;
  zone_id: string;
  x: number;
  y: number;
  z: number | null;
  title: string;
  substance: string | null;
  hazard: string;
  emergency_note: string | null;
  equipment_state: string;
  official: boolean;
  verified_by: string | null;
  verified_at: Date | null;
  version: number;
  status: 'active' | 'superseded';
  supersedes_tag_id: number | null;
  superseded_at: Date | null;
  created_by: string;
  created_at: Date;
}

interface CheckRow {
  id: number;
  tag_id: number;
  seq: number;
  item: string;
  needs: Needs;
  unit: string | null;
  required: boolean;
  range_min: number | null;
  range_max: number | null;
  range_max_exclusive: boolean;
}

export const checkDto = (c: CheckRow): CheckItemDto => ({
  id: c.id,
  tagId: c.tag_id,
  seq: c.seq,
  item: c.item,
  needs: c.needs,
  unit: c.unit,
  required: c.required,
  min: c.range_min,
  max: c.range_max,
  maxExclusive: c.range_max_exclusive,
});

/** 태그 + 확인 항목. ids 를 주면 그 순서 그대로 */
export async function loadTags(q: Queryable, f: { ids?: number[]; status?: 'active' | 'superseded' } = {}): Promise<TagDto[]> {
  if (f.ids && !f.ids.length) return [];
  const where = f.ids ? `WHERE id IN (${placeholders(f.ids.length)})` : f.status ? 'WHERE status = $1' : '';
  const params = f.ids ?? (f.status ? [f.status] : []);
  const rows = await q.query<TagRow>(
    `SELECT id, site_id, zone_id, x, y, z, title, substance, hazard, emergency_note, equipment_state, official,
            verified_by, verified_at, version, status, supersedes_tag_id, superseded_at, created_by, created_at
       FROM tag ${where} ORDER BY id`,
    params,
  );
  if (!rows.length) return [];
  const checks = await q.query<CheckRow>(
    `SELECT id, tag_id, seq, item, needs, unit, required, range_min, range_max, range_max_exclusive
       FROM check_item WHERE tag_id IN (${placeholders(rows.length)}) ORDER BY tag_id, seq`,
    rows.map((r) => r.id),
  );
  const tags = rows.map(
    (r): TagDto => ({
      id: r.id,
      siteId: r.site_id,
      zoneId: r.zone_id,
      title: r.title,
      substance: r.substance,
      hazard: r.hazard,
      emergencyNote: r.emergency_note,
      equipmentState: r.equipment_state,
      official: r.official,
      verifiedBy: r.verified_by,
      verifiedAt: r.verified_at,
      version: r.version,
      replacesId: r.supersedes_tag_id,
      supersededAt: r.superseded_at,
      x: r.x,
      y: r.y,
      z: r.z,
      status: r.status,
      checkItems: checks.filter((c) => c.tag_id === r.id).map(checkDto),
      createdBy: r.created_by,
      createdAt: r.created_at,
    }),
  );
  return f.ids ? f.ids.map((id) => tags.find((t) => t.id === id)).filter((t): t is TagDto => !!t) : tags;
}

interface WorkRow {
  id: number;
  code: string;
  site_id: string;
  zone_id: string;
  title: string;
  device_id: string;
  status: WorkStatus;
  published_by: string;
  published_at: Date;
  opened_at: Date | null;
  checked_in_at: Date | null;
  confirmed_at: Date | null;
  ended_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  permit_name: string | null;
  permit_url: string | null;
  permit_start: Date | null;
  permit_end: Date | null;
  permit_path: string | null;
  tag_ids: number[];
  total: number;
  done: number;
  required_left: number;
}

/** 작업 + 묶인 태그 id + 진행 (done / total / requiredLeft). 오래된 것부터 */
export async function loadWorks(q: Queryable, base: string, f: { id?: number; deviceId?: string } = {}): Promise<WorkDto[]> {
  const rows = await q.query<WorkRow>(
    `SELECT w.id, w.code, w.site_id, w.zone_id, w.title, w.device_id, w.status, w.published_by, w.published_at,
            w.opened_at, w.checked_in_at, w.confirmed_at, w.ended_at, w.cancelled_at, w.cancel_reason,
            w.permit_name, w.permit_url, w.permit_start, w.permit_end, pm.path AS permit_path,
            COALESCE((SELECT array_agg(wt.tag_id ORDER BY wt.seq) FROM work_tag wt WHERE wt.work_id = w.id), '{}') AS tag_ids,
            (SELECT count(*)::int FROM work_tag wt JOIN check_item ci ON ci.tag_id = wt.tag_id WHERE wt.work_id = w.id) AS total,
            (SELECT count(*)::int FROM confirmation c WHERE c.work_id = w.id) AS done,
            (SELECT count(*)::int FROM work_tag wt JOIN check_item ci ON ci.tag_id = wt.tag_id
              WHERE wt.work_id = w.id AND ci.required
                AND NOT EXISTS (SELECT 1 FROM confirmation c WHERE c.work_id = w.id AND c.check_item_id = ci.id)) AS required_left
       FROM work w LEFT JOIN media pm ON pm.id = w.permit_media_id
      WHERE ($1::int IS NULL OR w.id = $1) AND ($2::text IS NULL OR w.device_id = $2)
      ORDER BY w.id`,
    [f.id ?? null, f.deviceId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    siteId: r.site_id,
    title: r.title,
    zoneId: r.zone_id,
    deviceId: r.device_id,
    status: r.status,
    tagIds: r.tag_ids,
    permitName: r.permit_name,
    permitFileUrl: r.permit_path ? fileUrl(base, r.permit_path) : null,
    permitUrl: r.permit_url,
    permitStart: r.permit_start,
    permitEnd: r.permit_end,
    publishedBy: r.published_by,
    publishedAt: r.published_at,
    openedAt: r.opened_at,
    checkedInAt: r.checked_in_at,
    confirmedAt: r.confirmed_at,
    endedAt: r.ended_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    done: r.done,
    total: r.total,
    requiredLeft: r.required_left,
  }));
}

/** 단말의 '지금' 작업: 작업 중(confirmed)이 우선, 없으면 가장 최근에 받은 열린 작업 */
export function activeWorkOf(works: WorkDto[], deviceId: string): WorkDto | null {
  const open = works.filter((w) => w.deviceId === deviceId && isOpen(w.status));
  return open.findLast((w) => w.status === 'confirmed') ?? open.at(-1) ?? null;
}

export async function loadConfirmations(q: Queryable, base: string, workId: number): Promise<ConfirmationDto[]> {
  const rows = await q.query<{
    id: number;
    work_id: number;
    tag_id: number;
    check_item_id: number;
    value: number | null;
    photo_name: string | null;
    photo_path: string | null;
    device_id: string | null;
    confirmed_by: string;
    confirmed_at: Date;
  }>(
    `SELECT c.id, c.work_id, c.tag_id, c.check_item_id, c.value, c.photo_name, m.path AS photo_path,
            c.device_id, c.confirmed_by, c.confirmed_at
       FROM confirmation c LEFT JOIN media m ON m.id = c.photo_media_id
      WHERE c.work_id = $1 ORDER BY c.id`,
    [workId],
  );
  return rows.map((r) => ({
    id: r.id,
    workId: r.work_id,
    tagId: r.tag_id,
    checkItemId: r.check_item_id,
    value: r.value,
    photo: r.photo_path ? fileUrl(base, r.photo_path) : r.photo_name,
    deviceId: r.device_id,
    confirmedBy: r.confirmed_by,
    confirmedAt: r.confirmed_at,
  }));
}

interface AlertRow {
  id: number;
  site_id: string;
  type: 'fall' | 'abnormal';
  source: AlertSource;
  device_id: string | null;
  zone_id: string | null;
  work_id: number | null;
  status: AlertDto['status'];
  confidence: number | null;
  raised_at: Date;
  robot_unavailable: string | null;
  human_dispatched_at: Date | null;
  acknowledged_at: Date | null;
  resolution: 'handled' | 'false_alarm' | null;
  resolved_at: Date | null;
  tag_id: number | null;
  check_item_id: number | null;
  reading_value: number | null;
  rechecked_value: number | null;
  rechecked_at: Date | null;
  tag_title: string | null;
  ci_item: string | null;
  ci_unit: string | null;
  range_min: number | null;
  range_max: number | null;
  range_max_exclusive: boolean | null;
}

/** 알림 (측정 이상이면 측정값 · 정상 범위까지). 오래된 것부터 */
export async function loadAlerts(q: Queryable, f: { id?: number } = {}): Promise<AlertDto[]> {
  const rows = await q.query<AlertRow>(
    `SELECT a.id, a.site_id, a.type, a.source, a.device_id, a.zone_id, a.work_id, a.status, a.confidence, a.raised_at,
            a.robot_unavailable, a.human_dispatched_at, a.acknowledged_at, a.resolution, a.resolved_at,
            a.tag_id, a.check_item_id, a.reading_value, a.rechecked_value, a.rechecked_at,
            t.title AS tag_title, ci.item AS ci_item, ci.unit AS ci_unit,
            ci.range_min, ci.range_max, ci.range_max_exclusive
       FROM alert a
       LEFT JOIN tag t ON t.id = a.tag_id
       LEFT JOIN check_item ci ON ci.id = a.check_item_id
      WHERE ($1::int IS NULL OR a.id = $1)
      ORDER BY a.id`,
    [f.id ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    siteId: r.site_id,
    type: r.type,
    source: r.source,
    deviceId: r.device_id,
    zoneId: r.zone_id,
    workId: r.work_id,
    status: r.status,
    raisedAt: r.raised_at,
    acknowledgedAt: r.acknowledged_at,
    resolvedAt: r.resolved_at,
    resolution: r.resolution,
    robotUnavailable: r.robot_unavailable,
    humanDispatchedAt: r.human_dispatched_at,
    confidence: r.confidence,
    reading:
      r.type === 'abnormal' && r.check_item_id !== null
        ? {
            tagId: r.tag_id!,
            tagTitle: r.tag_title ?? '',
            checkItemId: r.check_item_id,
            item: r.ci_item ?? '',
            value: r.reading_value!,
            unit: r.ci_unit,
            range: fmtRange({ min: r.range_min, max: r.range_max, maxExclusive: r.range_max_exclusive, unit: r.ci_unit }),
            recheckedValue: r.rechecked_value,
            recheckedAt: r.rechecked_at,
          }
        : null,
  }));
}

export async function loadDispatches(q: Queryable): Promise<DispatchDto[]> {
  const rows = await q.query<{
    id: number;
    alert_id: number;
    goal_zone_id: string;
    computed: 'live' | 'precomputed';
    path: [number, number][];
    duration_s: number | null;
    status: DispatchDto['status'];
    planned_at: Date;
    started_at: Date | null;
    ended_at: Date | null;
  }>('SELECT id, alert_id, goal_zone_id, computed, path, duration_s, status, planned_at, started_at, ended_at FROM dispatch ORDER BY id');
  return rows.map((r) => ({
    id: r.id,
    alertId: r.alert_id,
    goalZoneId: r.goal_zone_id,
    computed: r.computed,
    path: r.path,
    durationS: r.duration_s ?? 0,
    startedAt: r.started_at ?? r.planned_at,
    endedAt: r.ended_at,
    status: r.status,
  }));
}

/** 이벤트. from ~ to(미포함) 사이, 최신 순 */
export async function loadEvents(q: Queryable, f: { from?: Date | null; to?: Date | null } = {}): Promise<EventDto[]> {
  const rows = await q.query<{
    seq: number;
    at: Date;
    type: string;
    actor: string;
    text: string;
    work_id: number | null;
    alert_id: number | null;
    tag_id: number | null;
    dispatch_id: number | null;
    drawing_id: number | null;
    device_id: string | null;
  }>(
    `SELECT seq, at, type, actor, text, work_id, alert_id, tag_id, dispatch_id, drawing_id, device_id FROM event
      WHERE ($1::timestamptz IS NULL OR at >= $1) AND ($2::timestamptz IS NULL OR at < $2)
      ORDER BY at DESC, seq DESC`,
    [f.from ?? null, f.to ?? null],
  );
  return rows.map((r) => ({
    seq: r.seq,
    at: r.at,
    type: r.type,
    actor: r.actor,
    text: r.text,
    workId: r.work_id,
    alertId: r.alert_id,
    tagId: r.tag_id,
    dispatchId: r.dispatch_id,
    drawingId: r.drawing_id,
    deviceId: r.device_id,
  }));
}

export async function loadDrawings(q: Queryable, base: string): Promise<DrawingDto[]> {
  const rows = await q.query<{
    id: number;
    site_id: string;
    title: string;
    kind: DrawingDto['kind'];
    dwg_no: string | null;
    revision: string;
    equipment: string[];
    file_name: string;
    mime: string;
    url: string | null;
    cad: boolean;
    maps_to_floor: boolean;
    note: string | null;
    uploaded_by: string;
    uploaded_at: Date;
    zone_ids: string[];
  }>(
    `SELECT d.id, d.site_id, d.title, d.kind, d.dwg_no, d.revision, d.equipment, d.file_name, d.mime, d.url, d.cad,
            d.maps_to_floor, d.note, d.uploaded_by, d.uploaded_at,
            COALESCE((SELECT array_agg(dz.zone_id ORDER BY dz.zone_id) FROM drawing_zone dz WHERE dz.drawing_id = d.id), '{}') AS zone_ids
       FROM drawing d ORDER BY d.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    siteId: r.site_id,
    title: r.title,
    kind: r.kind,
    dwgNo: r.dwg_no,
    revision: r.revision,
    zoneIds: r.zone_ids,
    equipment: r.equipment,
    fileName: r.file_name,
    mime: r.mime,
    // 프론트가 가진 정적 파일(/drawings/…)은 그대로, 올린 파일은 백엔드 주소로
    url: r.url ?? `${base}/api/drawing/file?id=${r.id}`,
    cad: r.cad,
    mapsToFloor: r.maps_to_floor,
    note: r.note,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by,
  }));
}

/** 태그 제목에 들어 있는 설비 번호로 도면을 찾는다 (태그가 새 버전이 돼도 연결 유지) */
export const drawingMatchesTag = (d: { equipment: string[] }, tagTitle: string) =>
  d.equipment.find((code) => tagTitle.includes(code)) ?? null;

/** 작업의 구역이나 태그 설비 번호에 걸리는 도면 */
export const drawingsFor = (drawings: DrawingDto[], work: WorkDto, tags: TagDto[]) =>
  drawings.filter((d) => d.zoneIds.includes(work.zoneId) || tags.some((t) => drawingMatchesTag(d, t.title)));
