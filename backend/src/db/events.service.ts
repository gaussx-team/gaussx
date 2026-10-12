import { Inject, Injectable } from '@nestjs/common';
import { SCENE, type Scene } from '../config/scene.js';
import { json, type Queryable } from './db.js';

/** event.type (DDL 의 CHECK 와 같아야 한다). 화면 이름표: frontend/src/lib/format.ts EVENT_LABEL */
export type EventType =
  | 'tag.created'
  | 'tag.revised'
  | 'tag.verified'
  | 'work.published'
  | 'card.opened'
  | 'work.checked_in'
  | 'check.confirmed'
  | 'check.rejected'
  | 'work.confirmed'
  | 'work.ended'
  | 'work.cancelled'
  | 'alert.raised'
  | 'alert.abnormal'
  | 'alert.acknowledged'
  | 'alert.resolved'
  | 'dispatch.started'
  | 'dispatch.arrived'
  | 'dispatch.failed'
  | 'dispatch.unavailable'
  | 'dispatch.human'
  | 'robot.mode'
  | 'drawing.uploaded'
  | 'session.reset';

export interface EventInput {
  type: EventType;
  actor: string;
  /** 이력 · 타임라인에 보일 한 줄 */
  text: string;
  tag_id?: number | null;
  work_id?: number | null;
  alert_id?: number | null;
  dispatch_id?: number | null;
  drawing_id?: number | null;
  device_id?: string | null;
  payload?: unknown;
  /** 지난 기록을 넣을 때만 (데모 데이터). 보통은 DB now() = 트랜잭션 시각 */
  at?: Date | string;
}

/** 이벤트 한 줄. 상태 변경과 **같은 트랜잭션의 q** 로 부른다 */
@Injectable()
export class EventsService {
  constructor(@Inject(SCENE) private readonly scene: Scene) {}

  async log(q: Queryable, e: EventInput): Promise<number> {
    const [row] = await q.query<{ seq: number }>(
      `INSERT INTO event (at, site_id, type, actor, text, tag_id, work_id, alert_id, dispatch_id, drawing_id, device_id, payload)
       VALUES (COALESCE($1::timestamptz, now()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb) RETURNING seq`,
      [
        e.at ?? null,
        this.scene.site.id,
        e.type,
        e.actor,
        e.text,
        e.tag_id ?? null,
        e.work_id ?? null,
        e.alert_id ?? null,
        e.dispatch_id ?? null,
        e.drawing_id ?? null,
        e.device_id ?? null,
        json(e.payload),
      ],
    );
    return row.seq;
  }
}
