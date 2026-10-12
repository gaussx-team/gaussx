import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SCENE, type Scene } from '../config/scene.js';
import { DB, type Db, placeholders, type Queryable } from '../db/db.js';
import { EventsService } from '../db/events.service.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { dayKey, fmtRange, inRange, isOpen, startOfDay } from '../domain/rules.js';
import {
  type ConfirmationDto,
  drawingsFor,
  loadAlerts,
  loadConfirmations,
  loadDispatches,
  loadDrawings,
  loadEvents,
  loadTags,
  loadWorks,
  loadZones,
  type WorkDto,
} from '../domain/views.js';
import { MediaService, parseDataUrl } from '../media/media.service.js';

export interface CreateWorkInput {
  title?: string;
  zoneId?: string;
  deviceId?: string;
  tagIds?: number[];
  permitName?: string | null;
  permitFile?: string | null;
  permitUrl?: string | null;
  permitStart?: string | null;
  permitEnd?: string | null;
}

export interface ConfirmInput {
  workId: number;
  checkItemId: number;
  value?: number | null;
  /** data URL(파일 내용) 또는 파일 이름 */
  photo?: string | null;
  photoMediaId?: number | null;
}

/** 작업 등록 → 카드 → 확인(체크인) → 확인 완료(작업 시작) → 종료 / 취소. 상태 변경과 이벤트는 항상 한 트랜잭션 */
@Injectable()
export class WorksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SCENE) private readonly scene: Scene,
    private readonly events: EventsService,
    private readonly media: MediaService,
    private readonly dispatch: DispatchService,
  ) {}

  async create(input: CreateWorkInput, base: string): Promise<WorkDto> {
    if (!input.title?.trim()) throw new BadRequestException('작업명을 입력해 주세요');
    if (!input.zoneId || !this.scene.zones.some((z) => z.id === input.zoneId)) throw new BadRequestException('구역을 선택해 주세요');
    if (!input.deviceId || !this.scene.devices.some((d) => d.id === input.deviceId)) {
      throw new BadRequestException(`작업을 받을 단말을 선택해 주세요${input.deviceId ? ` (등록되지 않은 단말: ${input.deviceId})` : ''}`);
    }
    const tagIds = [...new Set(input.tagIds ?? [])];
    if (!tagIds.length) throw new BadRequestException('태그를 1개 이상 묶어 주세요');
    const id = await this.db.tx(async (q) => {
      const tags = await q.query<{ id: number; status: string }>(
        `SELECT id, status FROM tag WHERE id IN (${placeholders(tagIds.length)})`,
        tagIds,
      );
      if (tags.length !== tagIds.length || tags.some((t) => t.status !== 'active')) {
        throw new BadRequestException('수정된 예전 버전 태그가 섞여 있어요. 화면을 새로고침해 주세요');
      }
      let permitMediaId: number | null = null;
      if (input.permitFile) {
        const f = parseDataUrl(input.permitFile);
        if (!f) throw new BadRequestException('작업허가서 파일 형식이 잘못됐어요 (data URL)');
        permitMediaId = (await this.media.save(q, 'permit_pdf', f.buf, { fileName: input.permitName, mime: f.mime })).id;
      }
      const [w] = await q.query<{ id: number; code: string }>(
        `INSERT INTO work (site_id, zone_id, title, device_id, published_by, permit_name, permit_media_id, permit_url, permit_start, permit_end)
         VALUES ($1, $2, $3, $4, '담당자', $5, $6, $7, $8::timestamptz, $9::timestamptz) RETURNING id, code`,
        [
          this.scene.site.id, input.zoneId, input.title!.trim(), input.deviceId, input.permitName || null, permitMediaId,
          input.permitUrl || null, input.permitStart || null, input.permitEnd || null,
        ],
      );
      for (const [i, tagId] of tagIds.entries()) {
        await q.query('INSERT INTO work_tag (work_id, tag_id, seq) VALUES ($1, $2, $3)', [w.id, tagId, i + 1]);
      }
      await this.events.log(q, {
        type: 'work.published',
        actor: '담당자',
        text: `${w.code} 작업 전송 → ${input.deviceId}`,
        work_id: w.id,
        device_id: input.deviceId,
        payload: { tags: tagIds, permitName: input.permitName ?? undefined },
      });
      return w.id;
    });
    return this.work(this.db, base, id);
  }

  /** 작업 카드: 기기로 찾으면 그 기기가 가장 최근에 받은 작업, 작업으로 찾으면 그 작업 (관리자 미리보기) */
  async card(q: { deviceId: string; workId: number | null }, base: string) {
    const works = await loadWorks(this.db, base);
    const work = q.workId ? (works.find((w) => w.id === q.workId) ?? null) : (works.findLast((w) => w.deviceId === q.deviceId) ?? null);
    if (q.workId && !work) throw new NotFoundException('작업을 찾을 수 없어요');
    const robot = await this.dispatch.robotView();
    if (!work) return { now: new Date(), work: null, zone: null, tags: [], confirmations: [], alert: null, abnormal: [], robot, drawings: [] };
    const [zones, tags, confirmations, alerts, drawings] = await Promise.all([
      loadZones(this.db),
      loadTags(this.db, { ids: work.tagIds }),
      loadConfirmations(this.db, base, work.id),
      loadAlerts(this.db),
      loadDrawings(this.db, base),
    ]);
    const openFall = alerts.filter((a) => a.type === 'fall' && a.status !== 'resolved');
    return {
      now: new Date(),
      work,
      zone: zones.find((z) => z.id === work.zoneId) ?? null,
      tags,
      confirmations,
      alert: openFall.findLast((a) => a.workId === work.id) ?? openFall.findLast((a) => a.deviceId === work.deviceId) ?? null,
      abnormal: alerts.filter((a) => a.type === 'abnormal' && a.status !== 'resolved' && a.workId === work.id),
      robot,
      drawings: drawingsFor(drawings, work, tags),
    };
  }

  /** 단말의 작업 목록: 열린 작업 전부 + 오늘 끝나거나 취소된 작업 (최근 순) */
  async inbox(deviceId: string, base: string) {
    const today = startOfDay(dayKey(new Date()));
    const doneAt = (w: WorkDto) => w.endedAt ?? w.cancelledAt ?? null;
    const works = (await loadWorks(this.db, base, { deviceId }))
      .filter((w) => isOpen(w.status) || (doneAt(w) !== null && doneAt(w)! >= today))
      .reverse();
    const alerts = await loadAlerts(this.db);
    return {
      now: new Date(),
      deviceId,
      works,
      zones: await loadZones(this.db),
      alert: alerts.findLast((a) => a.type === 'fall' && a.status !== 'resolved' && a.deviceId === deviceId) ?? null,
    };
  }

  /** 작업 등록 상세: 진행 · 확인 결과 · 알림 · 출동 · 기록 · 도면 */
  async detail(workId: number, base: string) {
    const work = await this.work(this.db, base, workId);
    const [zones, tags, confirmations, alerts, dispatches, events, drawings] = await Promise.all([
      loadZones(this.db),
      loadTags(this.db, { ids: work.tagIds }),
      loadConfirmations(this.db, base, work.id),
      loadAlerts(this.db),
      loadDispatches(this.db),
      loadEvents(this.db),
      loadDrawings(this.db, base),
    ]);
    const mine = alerts.filter((a) => a.workId === work.id);
    const alertIds = new Set(mine.map((a) => a.id));
    return {
      now: new Date(),
      work,
      zone: zones.find((z) => z.id === work.zoneId) ?? null,
      tags,
      confirmations,
      alerts: mine,
      dispatches: dispatches.filter((d) => alertIds.has(d.alertId)),
      events: events.filter((e) => e.workId === work.id || (e.alertId !== null && alertIds.has(e.alertId))),
      drawings: drawingsFor(drawings, work, tags),
    };
  }

  /** 카드 열람. 처음 열 때만 상태 → opened, 기록은 열 때마다 */
  async opened(workId: number, base: string): Promise<WorkDto> {
    await this.db.tx(async (q) => {
      const w = await this.lock(q, workId);
      await q.query(
        `UPDATE work SET opened_at = COALESCE(opened_at, now()),
                         status = CASE WHEN status = 'published' THEN 'opened' ELSE status END
          WHERE id = $1`,
        [workId],
      );
      await this.events.log(q, { type: 'card.opened', actor: w.device_id, text: `${w.code} 카드 열람`, work_id: workId, device_id: w.device_id });
    });
    return this.work(this.db, base, workId);
  }

  /**
   * 항목 확인 (추가 전용 · 되돌리지 않는다). 첫 확인 = 체크인.
   * 측정값이 정상 범위를 벗어나면 확인으로 저장하지 않고 '측정 이상' 알림을 관제에 남긴 뒤 400 (로봇 출동 없음).
   * 값 · 사진 필수, 범위, 중복, 작업에 없는 항목은 DB 도 막는다 (트리거 · 복합 FK · 유일 제약).
   */
  async confirm(input: ConfirmInput, base: string): Promise<ConfirmationDto> {
    const w = await this.lock(this.db, input.workId, false);
    if (w.status === 'ended') throw new BadRequestException('이미 종료된 작업이에요');
    if (w.status === 'cancelled') throw new BadRequestException('취소된 작업이에요');
    const [item] = await this.db.query<{
      id: number;
      tag_id: number;
      item: string;
      needs: string;
      unit: string | null;
      required: boolean;
      range_min: number | null;
      range_max: number | null;
      range_max_exclusive: boolean;
      tag_title: string;
    }>(
      `SELECT ci.id, ci.tag_id, ci.item, ci.needs, ci.unit, ci.required, ci.range_min, ci.range_max, ci.range_max_exclusive, t.title AS tag_title
         FROM check_item ci JOIN work_tag wt ON wt.tag_id = ci.tag_id AND wt.work_id = $1 JOIN tag t ON t.id = ci.tag_id
        WHERE ci.id = $2`,
      [input.workId, input.checkItemId],
    );
    if (!item) throw new BadRequestException('이 작업에 없는 확인 항목이에요');
    const [dup] = await this.db.query('SELECT 1 FROM confirmation WHERE work_id = $1 AND check_item_id = $2', [input.workId, item.id]);
    if (dup) throw new BadRequestException('이미 확인한 항목이에요 (수정 불가)');

    const value = input.value === undefined || input.value === null || Number.isNaN(input.value) ? null : input.value;
    if (item.needs === 'value') {
      if (value === null) throw new BadRequestException('값이 필요한 항목이에요');
      const range = { min: item.range_min, max: item.range_max, maxExclusive: item.range_max_exclusive, unit: item.unit };
      if (!inRange(range, value)) {
        await this.abnormal(w, item, value);
        throw new BadRequestException(
          `정상 범위(${fmtRange(range)})를 벗어났어요. 관제에 자동으로 알렸어요 — 다시 측정해 정상이면 진행할 수 있어요`,
        );
      }
    }
    const photoGiven = !!(input.photo || input.photoMediaId);
    if (item.needs === 'photo' && !photoGiven) throw new BadRequestException('사진이 필요한 항목이에요');

    const id = await this.db.tx(async (q) => {
      let photoMediaId: number | null = null;
      let photoName: string | null = null;
      if (item.needs === 'photo' || photoGiven) {
        if (input.photoMediaId) {
          await this.media.requireKind(q, input.photoMediaId, 'confirm_photo', '현장 사진');
          photoMediaId = input.photoMediaId;
        } else if (input.photo) {
          const f = parseDataUrl(input.photo);
          if (f) photoMediaId = (await this.media.save(q, 'confirm_photo', f.buf, { mime: f.mime })).id;
          else photoName = input.photo; // 파일 이름만 왔다 (목업 호환 · 임시)
        }
      }
      const [c] = await q.query<{ id: number; confirmed_at: Date }>(
        `INSERT INTO confirmation (work_id, tag_id, check_item_id, value, photo_media_id, photo_name, device_id, confirmed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '작업반장') RETURNING id, confirmed_at`,
        [w.id, item.tag_id, item.id, value, photoMediaId, photoName, w.device_id],
      );
      // 첫 확인 = 체크인
      const first = await q.query("UPDATE work SET checked_in_at = now() WHERE id = $1 AND checked_in_at IS NULL RETURNING id", [w.id]);
      if (first.length) {
        await this.events.log(q, { type: 'work.checked_in', actor: '작업반장', text: `${w.code} 체크인 · ${w.zone_id}`, work_id: w.id });
      }
      // 같은 항목에 열린 측정 이상이 있으면 '재측정 정상'으로 표시 (알림 종료는 관제가 판단)
      const rechecked = await q.query(
        `UPDATE alert SET rechecked_value = $3, rechecked_at = now()
          WHERE type = 'abnormal' AND status <> 'resolved' AND work_id = $1 AND check_item_id = $2 RETURNING id`,
        [w.id, item.id, value],
      );
      const val = value !== null ? ` · ${value}${item.unit ?? ''}` : photoMediaId || photoName ? ' · 사진' : '';
      await this.events.log(q, {
        type: 'check.confirmed',
        actor: '작업반장',
        text: `${item.tag_title} · ${item.item}${val}${rechecked.length ? ' (재측정)' : ''}`,
        work_id: w.id,
        tag_id: item.tag_id,
        device_id: w.device_id,
        payload: { checkItemId: item.id, value: value ?? undefined, photoMediaId: photoMediaId ?? undefined },
      });
      return c.id;
    });
    return (await loadConfirmations(this.db, base, w.id)).find((c) => c.id === id)!;
  }

  /** 확인 완료 = 작업 시작. 필수 항목을 다 했을 때만, 한 단말에서 작업 중은 하나만 */
  async complete(workId: number, base: string): Promise<WorkDto> {
    await this.db.tx(async (q) => {
      const w = await this.lock(q, workId);
      if (!isOpen(w.status)) throw new BadRequestException('종료되거나 취소된 작업이에요');
      if (w.status === 'confirmed') throw new BadRequestException('이미 작업이 시작됐어요');
      const [other] = await q.query<{ code: string }>(
        "SELECT code FROM work WHERE device_id = $1 AND status = 'confirmed' AND id <> $2",
        [w.device_id, workId],
      );
      if (other) throw new BadRequestException(`${other.code} 작업이 진행 중이에요. 먼저 종료한 뒤 시작해 주세요`);
      const [{ left }] = await q.query<{ left: number }>(
        `SELECT count(*)::int AS left FROM work_tag wt JOIN check_item ci ON ci.tag_id = wt.tag_id
          WHERE wt.work_id = $1 AND ci.required
            AND NOT EXISTS (SELECT 1 FROM confirmation c WHERE c.work_id = wt.work_id AND c.check_item_id = ci.id)`,
        [workId],
      );
      if (left > 0) throw new BadRequestException('필수 항목을 모두 확인해야 작업을 시작할 수 있어요');
      await q.query("UPDATE work SET status = 'confirmed', confirmed_by = '작업반장', confirmed_at = now() WHERE id = $1", [workId]);
      await this.events.log(q, { type: 'work.confirmed', actor: '작업반장', text: `${w.code} 확인 완료 · 작업 시작`, work_id: workId });
    });
    return this.work(this.db, base, workId);
  }

  async end(workId: number, base: string): Promise<WorkDto> {
    await this.db.tx(async (q) => {
      const w = await this.lock(q, workId);
      if (w.status === 'cancelled') throw new BadRequestException('취소된 작업이에요');
      if (w.status === 'ended') throw new BadRequestException('이미 종료된 작업이에요');
      if (w.status !== 'confirmed') throw new BadRequestException('작업을 시작한 뒤에 종료할 수 있어요. 시작 전이면 취소해 주세요');
      await q.query("UPDATE work SET status = 'ended', ended_by = '작업반장', ended_at = now() WHERE id = $1", [workId]);
      await this.events.log(q, { type: 'work.ended', actor: '작업반장', text: `${w.code} 작업 종료`, work_id: workId });
    });
    return this.work(this.db, base, workId);
  }

  /** 취소는 작업 시작 전에만, 사유 필수 */
  async cancel(workId: number, reason: string, base: string): Promise<WorkDto> {
    await this.db.tx(async (q) => {
      const w = await this.lock(q, workId);
      if (w.status !== 'published' && w.status !== 'opened') {
        throw new BadRequestException('작업이 시작된 뒤에는 취소할 수 없어요. 작업 종료로 처리해 주세요');
      }
      if (!reason.trim()) throw new BadRequestException('취소 사유를 적어 주세요');
      await q.query(
        "UPDATE work SET status = 'cancelled', cancelled_by = '담당자', cancelled_at = now(), cancel_reason = $2 WHERE id = $1",
        [workId, reason.trim()],
      );
      await this.events.log(q, {
        type: 'work.cancelled',
        actor: '담당자',
        text: `${w.code} 작업 취소 · ${reason.trim()}`,
        work_id: workId,
        payload: { reason: reason.trim() },
      });
    });
    return this.work(this.db, base, workId);
  }

  // ── 도우미 ──

  /** 측정 이상: check.rejected 를 남기고, 같은 항목의 열린 알림이 있으면 값만 고치고 없으면 새 알림 (로봇 출동 없음) */
  private async abnormal(
    w: { id: number; code: string; device_id: string; zone_id: string },
    item: { id: number; tag_id: number; item: string; unit: string | null; range_min: number | null; range_max: number | null; range_max_exclusive: boolean; tag_title: string },
    value: number,
  ) {
    const range = fmtRange({ min: item.range_min, max: item.range_max, maxExclusive: item.range_max_exclusive, unit: item.unit });
    const shown = `${value}${item.unit ?? ''}`;
    await this.db.tx(async (q) => {
      await this.events.log(q, {
        type: 'check.rejected',
        actor: '작업반장',
        text: `${item.tag_title} · ${item.item} · ${shown} (정상 ${range})`,
        work_id: w.id,
        tag_id: item.tag_id,
        device_id: w.device_id,
        payload: { checkItemId: item.id, value, range },
      });
      const open = await q.query<{ id: number }>(
        `UPDATE alert SET reading_value = $3 WHERE type = 'abnormal' AND status <> 'resolved' AND work_id = $1 AND check_item_id = $2
         RETURNING id`,
        [w.id, item.id, value],
      );
      if (open.length) return;
      const [a] = await q.query<{ id: number }>(
        `INSERT INTO alert (site_id, type, source, device_id, zone_id, work_id, status, tag_id, check_item_id, reading_value)
         VALUES ($1, 'abnormal', 'reading', $2, $3, $4, 'open', $5, $6, $7) RETURNING id`,
        [this.scene.site.id, w.device_id, w.zone_id, w.id, item.tag_id, item.id, value],
      );
      await this.events.log(q, {
        type: 'alert.abnormal',
        actor: 'system',
        text: `측정 이상 · ${w.zone_id} · ${item.tag_title} ${item.item} ${shown}`,
        alert_id: a.id,
        work_id: w.id,
        payload: { value, range },
      });
    });
  }

  private async lock(q: Queryable, workId: number, forUpdate = true) {
    const [w] = await q.query<{ id: number; code: string; status: string; device_id: string; zone_id: string }>(
      `SELECT id, code, status, device_id, zone_id FROM work WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
      [workId],
    );
    if (!w) throw new NotFoundException('작업을 찾을 수 없어요');
    return w as { id: number; code: string; status: WorkDto['status']; device_id: string; zone_id: string };
  }

  private async work(q: Queryable, base: string, id: number): Promise<WorkDto> {
    const [w] = await loadWorks(q, base, { id });
    if (!w) throw new NotFoundException('작업을 찾을 수 없어요');
    return w;
  }
}
