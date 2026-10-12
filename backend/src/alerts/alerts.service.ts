import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SCENE, type Scene } from '../config/scene.js';
import { DB, type Db, json, type Queryable } from '../db/db.js';
import { EventsService } from '../db/events.service.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import type { AlertSource } from '../domain/rules.js';
import { activeWorkOf, type AlertDto, loadAlerts, loadWorks } from '../domain/views.js';

export interface RaiseInput {
  source: Exclude<AlertSource, 'reading'>;
  deviceId?: string | null;
  zoneId?: string | null;
  confidence?: number | null;
  signal?: unknown;
  buffer?: unknown;
}

@Injectable()
export class AlertsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SCENE) private readonly scene: Scene,
    private readonly dispatch: DispatchService,
    private readonly events: EventsService,
  ) {}

  /**
   * 쓰러짐 (수동 SOS · 자동 감지 · 관제 직접 출동 · 무대 트리거). 알림과 동시에 로봇이 출발한다.
   * 구역: 직접 지정 → 그 단말의 작업 중 구역 → 불명. 로봇이 못 가면 '사람 출동 필요'(no_robot).
   */
  async raiseFall(input: RaiseInput): Promise<AlertDto> {
    if (input.deviceId && !this.scene.devices.some((d) => d.id === input.deviceId)) {
      throw new BadRequestException(`등록되지 않은 단말이에요: ${input.deviceId}`);
    }
    if (input.zoneId && !this.scene.zones.some((z) => z.id === input.zoneId)) {
      throw new BadRequestException(`없는 구역이에요: ${input.zoneId}`);
    }
    const work = input.deviceId ? activeWorkOf(await loadWorks(this.db, ''), input.deviceId) : null;
    const zoneId = input.zoneId ?? work?.zoneId ?? null;

    // 출동 가능 여부를 먼저 정하고 (자리를 잡아 두고) 알림을 저장한다
    let reason = await this.dispatch.blockedReason(this.db, zoneId);
    const seat = !reason && zoneId ? this.dispatch.reserve(zoneId) : null;
    if (!reason && !seat) reason = '다른 알림에 출동 중';

    let alertId: number;
    try {
      alertId = await this.db.tx(async (q) => {
        const [a] = await q.query<{ id: number }>(
          `INSERT INTO alert (site_id, type, source, device_id, zone_id, work_id, status, robot_unavailable, confidence, signal, buffer)
           VALUES ($1, 'fall', $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb) RETURNING id`,
          [
            this.scene.site.id, input.source, input.deviceId ?? null, zoneId, work?.id ?? null,
            reason ? 'no_robot' : 'dispatched', reason, input.confidence ?? null, json(input.signal), json(input.buffer),
          ],
        );
        await this.events.log(q, {
          type: 'alert.raised',
          actor: input.deviceId ?? '관제',
          text: `쓰러짐 · ${zoneId ?? '구역 불명'} · ${input.source}`,
          alert_id: a.id,
          work_id: work?.id ?? null,
          device_id: input.deviceId ?? null,
          payload: { source: input.source, zone: zoneId, confidence: input.confidence ?? undefined },
        });
        if (reason) {
          await this.events.log(q, {
            type: 'dispatch.unavailable',
            actor: 'system',
            text: `로봇 출동 불가 (${reason}) — 사람 출동 필요`,
            alert_id: a.id,
            work_id: work?.id ?? null,
            payload: { reason },
          });
        }
        return a.id;
      });
    } catch (e) {
      if (seat) this.dispatch.unreserve(seat);
      throw e;
    }
    if (seat) this.dispatch.launch(seat, alertId);
    return this.get(this.db, alertId);
  }

  /** 관제 확인 — 출동 조건이 아니라 기록용. 두 번 눌러도 처음 시각만 남는다 */
  async acknowledge(alertId: number): Promise<AlertDto> {
    return this.db.tx(async (q) => {
      const a = await this.lock(q, alertId);
      if (!a.acknowledged_at) {
        await q.query("UPDATE alert SET acknowledged_by = '관제', acknowledged_at = now() WHERE id = $1", [alertId]);
        await this.events.log(q, { type: 'alert.acknowledged', actor: '관제', text: `알림 A-${alertId} 관제 확인`, alert_id: alertId });
      }
      return this.get(q, alertId);
    });
  }

  /**
   * 알림 종료: 처리 완료(handled) · 오탐 해제(false_alarm, 작업자의 '괜찮아요' 포함).
   * 로봇이 가는 중이면 멈추고, 이 알림으로 출동했던 로봇은 대기 위치로 돌아간다 (데모 단순화 · 목업과 같다).
   */
  async resolve(alertId: number, resolution: 'handled' | 'false_alarm'): Promise<AlertDto> {
    const stopped = await this.db.tx(async (q) => {
      const a = await this.lock(q, alertId);
      if (a.status === 'resolved') return false;
      await q.query(
        "UPDATE alert SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1",
        [alertId, resolution, resolution === 'false_alarm' ? '작업반장/관제' : '관제'],
      );
      const mine = await q.query<{ id: number }>(
        `UPDATE dispatch SET status = CASE WHEN status IN ('planning', 'moving') THEN 'cancelled' ELSE status END,
                             ended_at = COALESCE(ended_at, now())
          WHERE alert_id = $1 RETURNING id`,
        [alertId],
      );
      const othersMoving = await q.query(
        "SELECT 1 FROM dispatch WHERE alert_id <> $1 AND status IN ('planning', 'moving') LIMIT 1",
        [alertId],
      );
      if (mine.length && !othersMoving.length) {
        await q.query(
          'UPDATE robot SET pose_x = home_x, pose_y = home_y, pose_yaw_rad = home_yaw_rad, pose_at = now() WHERE id = $1',
          [this.scene.robot.id],
        );
      }
      await this.events.log(q, {
        type: 'alert.resolved',
        actor: resolution === 'false_alarm' ? '작업반장/관제' : '관제',
        text: `알림 A-${alertId} ${resolution === 'false_alarm' ? '오탐 해제' : '처리 완료'}`,
        alert_id: alertId,
        work_id: a.work_id,
        payload: { resolution },
      });
      return mine.length > 0;
    });
    if (stopped) this.dispatch.stopFor(alertId);
    return this.get(this.db, alertId);
  }

  /** 로봇이 못 갈 때 관제가 안전관리자를 보낸다. 관제 확인도 함께 남는다 */
  async dispatchHuman(alertId: number): Promise<AlertDto> {
    return this.db.tx(async (q) => {
      const a = await this.lock(q, alertId);
      if (a.human_dispatched_at) throw new BadRequestException('이미 사람 출동을 지시했어요');
      await q.query(
        `UPDATE alert SET human_dispatched_by = '관제', human_dispatched_at = now(),
                          acknowledged_by = COALESCE(acknowledged_by, '관제'), acknowledged_at = COALESCE(acknowledged_at, now())
          WHERE id = $1`,
        [alertId],
      );
      await this.events.log(q, {
        type: 'dispatch.human',
        actor: '관제',
        text: `알림 A-${alertId} 안전관리자 출동 지시`,
        alert_id: alertId,
        work_id: a.work_id,
      });
      return this.get(q, alertId);
    });
  }

  private async lock(q: Queryable, id: number) {
    const [a] = await q.query<{ status: string; acknowledged_at: Date | null; human_dispatched_at: Date | null; work_id: number | null }>(
      'SELECT status, acknowledged_at, human_dispatched_at, work_id FROM alert WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!a) throw new NotFoundException('알림을 찾을 수 없어요');
    return a;
  }

  private async get(q: Queryable, id: number): Promise<AlertDto> {
    const [a] = await loadAlerts(q, { id });
    return a;
  }
}
