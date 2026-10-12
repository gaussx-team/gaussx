import { Inject, Injectable, Logger } from '@nestjs/common';
import { readJson, type Route, SCENE, type Scene } from '../config/scene.js';
import { DB, type Db, json, type Queryable, textArray } from '../db/db.js';
import { EventsService } from '../db/events.service.js';
import { dayKey } from '../domain/rules.js';

// seed.json 모양 (scenes/dev/demo/seed.json)
interface SeedCheck {
  item: string;
  needs?: 'none' | 'value' | 'photo';
  unit?: string | null;
  required?: boolean;
  min?: number | null;
  max?: number | null;
  maxExclusive?: boolean;
}
interface SeedTag {
  key: string;
  zoneId: string;
  title: string;
  substance?: string | null;
  hazard: string;
  emergencyNote?: string | null;
  equipmentState: string;
  official?: boolean;
  verifiedBy?: string | null;
  x: number;
  y: number;
  at: string;
  by: string;
  checkItems: SeedCheck[];
}
interface SeedRevision {
  key: string;
  tag: string;
  at: string;
  by: string;
  patch: Partial<Omit<SeedTag, 'key' | 'at' | 'by' | 'checkItems'>> & { checkItems?: SeedCheck[] };
}
interface SeedDrawing {
  title: string;
  kind: string;
  dwgNo?: string | null;
  revision?: string;
  zoneIds: string[];
  equipment: string[];
  fileName: string;
  url: string;
  mime: string;
  cad?: boolean;
  mapsToFloor?: boolean;
  note?: string | null;
  at: string;
  by: string;
}
interface SeedWorkCheck {
  tag: string;
  n: number;
  value?: number;
  photo?: string;
  at?: string;
}
interface SeedWork {
  title: string;
  zoneId: string;
  deviceId: string;
  tags: string[];
  permitName?: string;
  checks?: SeedWorkCheck[];
  /** 지난 작업: 시작 · 종료 시각만 주면 나머지는 목업과 같은 간격으로 (열람 +3분, 체크인 +5분, 확인 2분 간격) */
  past?: { start: string; end: string };
  alert?: { source: string; at: string; ack?: string; resolved: string; resolution: 'handled' | 'false_alarm' };
  // 진행 중 작업: 단계별 시각
  published?: string;
  opened?: string;
  confirmed?: string;
  permit?: [string, string];
}
interface SeedFile {
  tags: SeedTag[];
  revisions?: SeedRevision[];
  drawings?: SeedDrawing[];
  works?: SeedWork[];
}

const MIN = 60_000;

/**
 * 시각 표현 → Date. 'D-6 09:30'(6일 전 KST 09:30, 초까지 가능) · '-50m'(50분 전) · 'now' · 'H+8'(지금 정시 + 8시간)
 */
export function seedTime(expr: string, now: Date): Date {
  let m = /^D-(\d+) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(expr);
  if (m) {
    const day = dayKey(new Date(now.getTime() - Number(m[1]) * 86_400_000));
    return new Date(`${day}T${m[2]}:${m[3]}:${m[4] ?? '00'}+09:00`);
  }
  m = /^-(\d+)m$/.exec(expr);
  if (m) return new Date(now.getTime() - Number(m[1]) * MIN);
  if (expr === 'now') return now;
  m = /^H\+(\d+)$/.exec(expr);
  if (m) {
    const h = new Date(now);
    h.setUTCMinutes(0, 0, 0);
    return new Date(h.getTime() + Number(m[1]) * 3_600_000);
  }
  throw new Error(`seed.json 시각 표현을 모릅니다: ${expr}`);
}

const hourFloor = (d: Date) => {
  const h = new Date(d);
  h.setUTCMinutes(0, 0, 0);
  return h;
};
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

interface ItemRow {
  id: number;
  item: string;
  needs: string;
  unit: string | null;
}

/**
 * 새 회차에 데모 데이터를 넣는다 (프론트 목업의 seed 와 같은 내용).
 * 기록을 지난 시각으로 넣어야 해서 API 를 거치지 않고 SQL 로 바로 넣는다 — DB 규칙(트리거 · 제약)은 똑같이 지킨다.
 */
@Injectable()
export class Seeder {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SCENE) private readonly scene: Scene,
    private readonly events: EventsService,
  ) {}

  async seed(now = new Date()): Promise<{ tags: number; works: number; drawings: number } | null> {
    if (!this.scene.seedPath) return null;
    const file = readJson(this.scene.seedPath) as unknown as SeedFile;
    const T = (e: string) => seedTime(e, now);
    try {
      const out = await this.db.tx(async (q) => {
        const tagIds = new Map<string, number>();
        const items = new Map<string, ItemRow[]>();
        const titles = new Map<string, string>();

        const insertTag = async (t: SeedTag, at: Date, extra: { version: number; supersedes: number | null; official: boolean; verifiedBy: string | null; verifiedAt: Date | null }) => {
          const [row] = await q.query<{ id: number }>(
            `INSERT INTO tag (site_id, zone_id, scan_id, x, y, title, substance, hazard, emergency_note, equipment_state,
                              official, verified_by, verified_at, version, supersedes_tag_id, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
            [
              this.scene.site.id, t.zoneId, this.scene.scan.id, t.x, t.y, t.title, t.substance ?? null, t.hazard,
              t.emergencyNote ?? null, t.equipmentState, extra.official, extra.verifiedBy, extra.verifiedAt,
              extra.version, extra.supersedes, t.by, at,
            ],
          );
          const rows: ItemRow[] = [];
          for (const [i, c] of t.checkItems.entries()) {
            const [ci] = await q.query<ItemRow>(
              `INSERT INTO check_item (tag_id, seq, item, needs, unit, required, range_min, range_max, range_max_exclusive)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, item, needs, unit`,
              [row.id, i + 1, c.item, c.needs ?? 'none', c.unit ?? null, c.required ?? true, c.min ?? null, c.max ?? null, c.maxExclusive ?? false],
            );
            rows.push(ci);
          }
          return { id: row.id, items: rows };
        };

        // ── 태그 ──
        for (const t of file.tags) {
          const at = T(t.at);
          const official = t.official ?? false;
          const r = await insertTag(t, at, {
            version: 1,
            supersedes: null,
            official,
            verifiedBy: official ? (t.verifiedBy ?? '원청 안전팀') : null,
            verifiedAt: official ? at : null,
          });
          tagIds.set(t.key, r.id);
          items.set(t.key, r.items);
          titles.set(t.key, t.title);
          await this.events.log(q, { type: 'tag.created', actor: t.by, text: `${t.title} 태그 생성 (${t.zoneId})`, tag_id: r.id, at });
        }

        // ── 태그 수정 = 새 버전 ──
        for (const rv of file.revisions ?? []) {
          const base = file.tags.find((t) => t.key === rv.tag);
          const oldId = tagIds.get(rv.tag);
          if (!base || oldId === undefined) throw new Error(`revisions: 없는 태그 ${rv.tag}`);
          const [old] = await q.query<{ version: number; official: boolean; verified_by: string | null; verified_at: Date | null }>(
            'SELECT version, official, verified_by, verified_at FROM tag WHERE id = $1',
            [oldId],
          );
          const at = T(rv.at);
          const next: SeedTag = { ...base, ...rv.patch, key: rv.key, at: rv.at, by: rv.by, checkItems: rv.patch.checkItems ?? base.checkItems };
          const r = await insertTag(next, at, {
            version: old.version + 1,
            supersedes: oldId,
            official: old.official,
            verifiedBy: old.verified_by,
            verifiedAt: old.verified_at,
          });
          await q.query("UPDATE tag SET status = 'superseded', superseded_at = $2 WHERE id = $1", [oldId, at]);
          tagIds.set(rv.key, r.id);
          items.set(rv.key, r.items);
          titles.set(rv.key, next.title);
          await this.events.log(q, {
            type: 'tag.revised',
            actor: rv.by,
            text: `${next.title} v${old.version + 1} 저장 (이전 v${old.version} 보관)`,
            tag_id: r.id,
            payload: { replaces: oldId },
            at,
          });
        }

        // ── 도면 (프론트가 가진 정적 파일 /drawings/…) ──
        for (const d of file.drawings ?? []) {
          const [row] = await q.query<{ id: number }>(
            `INSERT INTO drawing (site_id, title, kind, dwg_no, revision, equipment, file_name, mime, url, cad, maps_to_floor,
                                  note, uploaded_by, uploaded_at)
             VALUES ($1, $2, $3, $4, $5, ARRAY(SELECT jsonb_array_elements_text($6::jsonb)), $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id`,
            [
              this.scene.site.id, d.title, d.kind, d.dwgNo ?? null, d.revision ?? 'REV.0', textArray(d.equipment), d.fileName,
              d.mime, d.url, d.cad ?? false, d.mapsToFloor ?? false, d.note ?? null, d.by, T(d.at),
            ],
          );
          for (const z of d.zoneIds) await q.query('INSERT INTO drawing_zone (drawing_id, zone_id) VALUES ($1, $2)', [row.id, z]);
        }

        // ── 작업 ──
        for (const w of file.works ?? []) await this.insertWork(q, w, T, tagIds, items, titles);

        return { tags: tagIds.size, works: file.works?.length ?? 0, drawings: file.drawings?.length ?? 0 };
      });
      new Logger('Seed').log(`데모 데이터: 태그 ${out.tags} · 작업 ${out.works} · 도면 ${out.drawings}`);
      return out;
    } catch (e) {
      throw new Error(`${this.scene.seedPath} 을 넣지 못했습니다: ${(e as Error).message}`);
    }
  }

  private async insertWork(
    q: Queryable,
    w: SeedWork,
    T: (e: string) => Date,
    tagIds: Map<string, number>,
    items: Map<string, ItemRow[]>,
    titles: Map<string, string>,
  ) {
    const checks = w.checks ?? [];
    // 단계별 시각
    let published: Date, opened: Date | null, confirmed: Date | null, ended: Date | null, permit: [Date, Date] | null;
    let checkAt: Date[];
    if (w.past) {
      published = T(w.past.start);
      opened = plus(published, 3 * MIN);
      checkAt = checks.map((_, i) => plus(published, (5 + i * 2) * MIN));
      confirmed = plus(published, (5 + checks.length * 2) * MIN);
      ended = T(w.past.end);
      permit = [hourFloor(published), plus(hourFloor(ended), 3_600_000)];
    } else {
      published = T(w.published ?? 'now');
      opened = w.opened ? T(w.opened) : null;
      checkAt = checks.map((c) => T(c.at ?? 'now'));
      confirmed = w.confirmed ? T(w.confirmed) : null;
      ended = null;
      permit = w.permit ? [T(w.permit[0]), T(w.permit[1])] : null;
    }
    const checkedIn = checkAt.length ? checkAt[0] : null;
    const status = ended ? 'ended' : confirmed ? 'confirmed' : opened ? 'opened' : 'published';

    const [row] = await q.query<{ id: number; code: string }>(
      `INSERT INTO work (site_id, zone_id, title, device_id, status, published_by, published_at, opened_at, checked_in_at,
                         confirmed_by, confirmed_at, ended_by, ended_at, permit_start, permit_end)
       VALUES ($1, $2, $3, $4, $5, '원청 담당자', $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id, code`,
      [
        this.scene.site.id, w.zoneId, w.title, w.deviceId, status, published, opened, checkedIn,
        confirmed ? '작업반장' : null, confirmed, ended ? '작업반장' : null, ended, permit?.[0] ?? null, permit?.[1] ?? null,
      ],
    );
    await q.query('UPDATE work SET permit_name = $2 WHERE id = $1', [row.id, w.permitName ?? `작업허가서_${row.code}.pdf`]);
    for (const [i, key] of w.tags.entries()) {
      const id = tagIds.get(key);
      if (id === undefined) throw new Error(`${w.title}: 없는 태그 ${key}`);
      await q.query('INSERT INTO work_tag (work_id, tag_id, seq) VALUES ($1, $2, $3)', [row.id, id, i + 1]);
    }

    const log = this.events.log.bind(this.events);
    await log(q, { type: 'work.published', actor: '원청 담당자', text: `${row.code} 작업 전송 → ${w.deviceId}`, work_id: row.id, device_id: w.deviceId, at: published });
    if (opened) await log(q, { type: 'card.opened', actor: w.deviceId, text: `${row.code} 카드 열람`, work_id: row.id, device_id: w.deviceId, at: opened });
    if (checkedIn) await log(q, { type: 'work.checked_in', actor: '작업반장', text: `${row.code} 체크인 · ${w.zoneId}`, work_id: row.id, at: checkedIn });
    for (const [i, c] of checks.entries()) {
      const it = items.get(c.tag)?.[c.n];
      if (!it) throw new Error(`${w.title}: ${c.tag} 의 ${c.n}번 항목이 없습니다`);
      await q.query(
        `INSERT INTO confirmation (work_id, tag_id, check_item_id, value, photo_name, device_id, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, $6, '작업반장', $7)`,
        [row.id, tagIds.get(c.tag), it.id, c.value ?? null, c.photo ?? null, w.deviceId, checkAt[i]],
      );
      const val = c.value != null ? ` · ${c.value}${it.unit ?? ''}` : c.photo ? ' · 사진' : '';
      await log(q, {
        type: 'check.confirmed',
        actor: '작업반장',
        text: `${titles.get(c.tag)} · ${it.item}${val}`,
        work_id: row.id,
        tag_id: tagIds.get(c.tag),
        device_id: w.deviceId,
        payload: { checkItemId: it.id, value: c.value, photo: c.photo },
        at: checkAt[i],
      });
    }
    if (confirmed) await log(q, { type: 'work.confirmed', actor: '작업반장', text: `${row.code} 확인 완료 · 작업 시작`, work_id: row.id, at: confirmed });
    if (w.alert) await this.insertPastAlert(q, w, row.id, T);
    if (ended) await log(q, { type: 'work.ended', actor: '작업반장', text: `${row.code} 작업 종료`, work_id: row.id, at: ended });
  }

  /** 지난 쓰러짐 알림: 사전 계산표로 출동 → 도착 → (관제 확인) → 처리 완료 / 오탐 해제 */
  private async insertPastAlert(q: Queryable, w: SeedWork, workId: number, T: (e: string) => Date) {
    const a = w.alert!;
    const raised = T(a.at);
    const resolved = T(a.resolved);
    const ack = a.ack ? T(a.ack) : null;
    const route: Route | undefined = this.scene.routes?.routes.find((r) => r.from === 'home' && r.to === w.zoneId);
    const [row] = await q.query<{ id: number }>(
      `INSERT INTO alert (site_id, type, source, device_id, zone_id, work_id, status, raised_at, acknowledged_by, acknowledged_at,
                          resolution, resolved_by, resolved_at, robot_unavailable)
       VALUES ($1, 'fall', $2, $3, $4, $5, 'resolved', $6, $7, $8, $9, '작업반장', $10, $11) RETURNING id`,
      [this.scene.site.id, a.source, w.deviceId, w.zoneId, workId, raised, ack ? '관제' : null, ack, a.resolution, resolved, route ? null : '경로 없음'],
    );
    const log = this.events.log.bind(this.events);
    await log(q, { type: 'alert.raised', actor: w.deviceId, text: `쓰러짐 · ${w.zoneId} · ${a.source}`, alert_id: row.id, work_id: workId, device_id: w.deviceId, at: raised });
    if (route) {
      const arrived = plus(raised, route.duration_s * 1000);
      const start = this.scene.routes!.starts.home;
      const [d] = await q.query<{ id: number }>(
        `INSERT INTO dispatch (alert_id, robot_id, scan_id, goal_zone_id, computed, start_x, start_y, start_yaw_rad, goal_x, goal_y,
                               snapped, path, trajectory, status, reached, duration_s, distance_m, planned_at, started_at, ended_at)
         VALUES ($1, $2, $3, $4, 'precomputed', $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, 'arrived', $13, $14, $15, $16, $16, $17)
         RETURNING id`,
        [
          row.id, this.scene.robot.id, this.scene.scan.id, w.zoneId, start.x, start.y, start.yaw, route.goal[0], route.goal[1],
          route.snapped, json(route.path), json(route.trajectory), route.reached, route.duration_s, route.distance_m, raised, arrived,
        ],
      );
      await log(q, { type: 'dispatch.started', actor: 'system', text: `로봇 출동 → ${w.zoneId} (미리 계산한 경로)`, alert_id: row.id, dispatch_id: d.id, at: raised });
      await log(q, { type: 'dispatch.arrived', actor: 'system', text: `로봇 ${w.zoneId} 도착 (${route.duration_s.toFixed(1)}초)`, alert_id: row.id, dispatch_id: d.id, at: arrived });
    }
    if (ack) await log(q, { type: 'alert.acknowledged', actor: '관제', text: `알림 A-${row.id} 관제 확인`, alert_id: row.id, at: ack });
    await log(q, {
      type: 'alert.resolved',
      actor: '작업반장',
      text: `알림 A-${row.id} ${a.resolution === 'false_alarm' ? '오탐 해제' : '처리 완료'}`,
      alert_id: row.id,
      payload: { resolution: a.resolution },
      at: resolved,
    });
  }
}
