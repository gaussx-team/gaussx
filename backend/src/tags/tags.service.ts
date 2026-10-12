import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SCENE, type Scene } from '../config/scene.js';
import { DB, type Db, type Queryable } from '../db/db.js';
import { EventsService } from '../db/events.service.js';
import { loadTags, loadWorks, loadZones, type TagDto } from '../domain/views.js';

export const EQUIPMENT_STATES = ['running', 'stopped', 'valve_open', 'valve_closed', 'deteriorated'] as const;

export interface CheckInput {
  item?: string;
  needs?: 'none' | 'value' | 'photo';
  unit?: string | null;
  required?: boolean;
  min?: number | null;
  max?: number | null;
  maxExclusive?: boolean | null;
}

export interface TagInput {
  zoneId?: string;
  title?: string;
  substance?: string | null;
  hazard?: string;
  emergencyNote?: string | null;
  equipmentState?: string;
  official?: boolean;
  x?: number;
  y?: number;
  z?: number | null;
  checkItems?: CheckInput[];
}

const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** 위험 태그: 만들기 · 수정(= 새 버전) · 승인(미확인 → 공식). 내용을 고치지 않는 규칙은 DB 트리거(tag_guard)도 지킨다 */
@Injectable()
export class TagsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SCENE) private readonly scene: Scene,
    private readonly events: EventsService,
  ) {}

  /** 태그 화면: 현재 버전 · 예전 버전 · 어느 작업이 어느 버전을 썼는지 */
  async list() {
    const [zones, tags, works] = await Promise.all([loadZones(this.db), loadTags(this.db), loadWorks(this.db, '')]);
    return {
      zones,
      tags: tags.filter((t) => t.status === 'active'),
      history: tags.filter((t) => t.status === 'superseded'),
      works: works.map(({ id, code, tagIds }) => ({ id, code, tagIds })),
    };
  }

  async create(input: TagInput): Promise<TagDto> {
    const t = this.validate(input, true);
    const id = await this.db.tx(async (q) => {
      const id = await this.insert(q, t, { version: 1, supersedes: null, official: t.official, keepVerified: null });
      await this.events.log(q, { type: 'tag.created', actor: '담당자', text: `${t.title} 태그 생성 (${t.zoneId})`, tag_id: id });
      return id;
    });
    return this.get(id);
  }

  /** 수정 = 새 버전 줄. 예전 줄은 superseded 로 남고, 이미 보낸 작업은 예전 버전을 계속 가리킨다 */
  async revise(tagId: number, patch: TagInput): Promise<TagDto> {
    if (patch.title !== undefined && !patch.title.trim()) throw new BadRequestException('설비 이름은 비울 수 없어요');
    if (patch.hazard !== undefined && !patch.hazard.trim()) throw new BadRequestException('위험 문구는 비울 수 없어요');
    if (patch.checkItems && !patch.checkItems.length) throw new BadRequestException('작업 전 확인 항목이 1개 이상 필요해요');
    const id = await this.db.tx(async (q) => {
      await q.query('SELECT id FROM tag WHERE id = $1 FOR UPDATE', [tagId]); // 동시에 두 번 고쳐도 새 버전은 하나
      const [old] = await loadTags(q, { ids: [tagId] });
      if (!old) throw new NotFoundException('태그를 찾을 수 없어요');
      if (old.status !== 'active') throw new BadRequestException('이미 수정된 예전 버전이에요. 최신 버전에서 수정해 주세요');
      const merged = this.validate(
        {
          zoneId: patch.zoneId ?? old.zoneId,
          title: patch.title ?? old.title,
          substance: patch.substance !== undefined ? patch.substance : old.substance,
          hazard: patch.hazard ?? old.hazard,
          emergencyNote: patch.emergencyNote !== undefined ? patch.emergencyNote : old.emergencyNote,
          equipmentState: patch.equipmentState ?? old.equipmentState,
          official: patch.official ?? old.official,
          x: patch.x ?? old.x,
          y: patch.y ?? old.y,
          z: patch.z !== undefined ? patch.z : old.z,
          checkItems: patch.checkItems ?? old.checkItems,
        },
        false,
      );
      // 공식 태그를 고치면 승인 정보는 그대로, 미확인 태그를 공식으로 고치면 지금 승인한 것으로
      const keepVerified = merged.official && old.official ? { by: old.verifiedBy, at: old.verifiedAt } : null;
      const id = await this.insert(q, merged, { version: old.version + 1, supersedes: old.id, official: merged.official, keepVerified });
      await q.query("UPDATE tag SET status = 'superseded', superseded_at = now() WHERE id = $1", [old.id]);
      await this.events.log(q, {
        type: 'tag.revised',
        actor: '담당자',
        text: `${merged.title} v${old.version + 1} 저장 (이전 v${old.version} 보관)`,
        tag_id: id,
        payload: { replaces: old.id },
      });
      return id;
    });
    return this.get(id);
  }

  /** 승인: 미확인 → 공식 (한 번, 되돌리지 않는다) */
  async verify(tagId: number): Promise<TagDto> {
    await this.db.tx(async (q) => {
      const [t] = await q.query<{ status: string; official: boolean; title: string }>(
        'SELECT status, official, title FROM tag WHERE id = $1 FOR UPDATE',
        [tagId],
      );
      if (!t) throw new NotFoundException('태그를 찾을 수 없어요');
      if (t.status !== 'active') throw new BadRequestException('예전 버전은 승인할 수 없어요');
      if (t.official) throw new BadRequestException('이미 공식 태그예요');
      await q.query("UPDATE tag SET official = true, verified_by = '원청 안전팀', verified_at = now() WHERE id = $1", [tagId]);
      await this.events.log(q, { type: 'tag.verified', actor: '원청 안전팀', text: `${t.title} 공식 태그로 승인`, tag_id: tagId });
    });
    return this.get(tagId);
  }

  // ── 도우미 ──

  private validate(input: TagInput, isNew: boolean) {
    const title = input.title?.trim() ?? '';
    const hazard = input.hazard?.trim() ?? '';
    if (isNew && (!title || !hazard)) throw new BadRequestException('설비 이름과 위험 문구는 필수예요');
    const checks = input.checkItems ?? [];
    if (!checks.length) throw new BadRequestException('작업 전 확인 항목이 1개 이상 필요해요');
    if (!input.zoneId || !this.scene.zones.some((z) => z.id === input.zoneId)) throw new BadRequestException('구역을 선택해 주세요');
    const state = input.equipmentState ?? 'running';
    if (!(EQUIPMENT_STATES as readonly string[]).includes(state)) throw new BadRequestException(`알 수 없는 설비 상태예요: ${state}`);
    if (typeof input.x !== 'number' || typeof input.y !== 'number') throw new BadRequestException('평면도에서 설비 위치를 눌러 주세요');
    const items = checks.map((c, i) => {
      const item = c.item?.trim();
      if (!item) throw new BadRequestException(`확인 항목 ${i + 1}번의 내용을 적어 주세요`);
      const needs = c.needs ?? 'none';
      const isValue = needs === 'value';
      const min = isValue ? (c.min ?? null) : null;
      const max = isValue ? (c.max ?? null) : null;
      if (min !== null && max !== null && min > max) throw new BadRequestException(`${item}: 최소값이 최대값보다 커요`);
      return { item, needs, unit: blankToNull(c.unit), required: c.required ?? true, min, max, maxExclusive: isValue && !!c.maxExclusive };
    });
    return {
      zoneId: input.zoneId,
      title,
      substance: blankToNull(input.substance),
      hazard,
      emergencyNote: blankToNull(input.emergencyNote),
      equipmentState: state,
      official: !!input.official,
      x: input.x,
      y: input.y,
      z: input.z ?? null,
      items,
    };
  }

  private async insert(
    q: Queryable,
    t: ReturnType<TagsService['validate']>,
    o: { version: number; supersedes: number | null; official: boolean; keepVerified: { by: string | null; at: Date | null } | null },
  ): Promise<number> {
    const [row] = await q.query<{ id: number }>(
      `INSERT INTO tag (site_id, zone_id, scan_id, x, y, z, title, substance, hazard, emergency_note, equipment_state,
                        official, verified_by, verified_at, version, supersedes_tag_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14::timestamptz, CASE WHEN $12 THEN now() END), $15, $16, '담당자')
       RETURNING id`,
      [
        this.scene.site.id, t.zoneId, this.scene.scan.id, t.x, t.y, t.z, t.title, t.substance, t.hazard, t.emergencyNote,
        t.equipmentState, o.official, o.official ? (o.keepVerified?.by ?? '원청 안전팀') : null, o.keepVerified?.at ?? null,
        o.version, o.supersedes,
      ],
    );
    for (const [i, c] of t.items.entries()) {
      await q.query(
        `INSERT INTO check_item (tag_id, seq, item, needs, unit, required, range_min, range_max, range_max_exclusive)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.id, i + 1, c.item, c.needs, c.unit, c.required, c.min, c.max, c.maxExclusive],
      );
    }
    return row.id;
  }

  private async get(id: number): Promise<TagDto> {
    const [t] = await loadTags(this.db, { ids: [id] });
    return t;
  }
}
