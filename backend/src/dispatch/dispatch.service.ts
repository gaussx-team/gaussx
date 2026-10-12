import { BadRequestException, Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ComputeClient, type Simulation } from '../compute/compute.client.js';
import { type Pose, SCENE, type Scene, type TrajPoint, type Xy } from '../config/scene.js';
import { SETTINGS, type Settings } from '../config/settings.js';
import { DB, type Db, json, type Queryable } from '../db/db.js';
import { EventsService } from '../db/events.service.js';
import { ROBOT_MODE_LABEL, type RobotMode } from '../domain/rules.js';
import type { RobotDto } from '../domain/views.js';

type Computed = 'live' | 'precomputed';

interface Plan {
  computed: Computed;
  start: Pose;
  path: Xy[];
  goal: Xy;
  snapped: boolean;
}

/** 지금 진행 중인 출동 하나 (메모리. 서버 프로세스는 하나여야 한다) */
interface Active {
  alertId: number;
  zone: string;
  dispatchId: number | null;
  plan: Plan | null;
  sim: Simulation | null;
  /** 출발 시각 (서버 시계, ms). 궤적 재생 위치 = 경과 × 배속 */
  startedAt: number | null;
  timer: NodeJS.Timeout | null;
  cancelled: boolean;
}

interface DispatchRow {
  id: number;
  alert_id: number;
  goal_zone_id: string;
  computed: Computed;
  status: 'planning' | 'moving';
  start_x: number;
  start_y: number;
  start_yaw_rad: number;
  goal_x: number;
  goal_y: number;
  snapped: boolean;
  path: Xy[];
  trajectory: TrajPoint[] | null;
  reached: boolean | null;
  duration_s: number | null;
  distance_m: number | null;
  since_s: number | null;
}

/** 그 사이 알림이 끝나 출동을 그만둔다 */
class Cancelled extends Error {}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
export const ROBOT_MODES: RobotMode[] = ['ready', 'charging', 'maintenance', 'offline'];

/** 궤적 [t, x, y, yaw] 에서 t 초의 자세 (선형 보간) */
export function sampleTrajectory(traj: TrajPoint[], t: number): [number, number, number] {
  if (t <= traj[0][0]) return [traj[0][1], traj[0][2], traj[0][3]];
  for (let i = 1; i < traj.length; i++) {
    const b = traj[i];
    if (t <= b[0]) {
      const a = traj[i - 1];
      const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1;
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, wrapAngle(a[3] + wrapAngle(b[3] - a[3]) * k)];
    }
  }
  const z = traj[traj.length - 1];
  return [z[1], z[2], z[3]];
}

/**
 * 로봇 출동. 알림과 동시에 자동 출동하고 관제 확인을 기다리지 않는다 (10/10 결정).
 *
 *   경로: 계산 서비스 /route(1초) · /simulate(5초) → 실패하면 사전 계산표(routes.json, 로봇 자세에서 가장 가까운 출발점)
 *   → dispatch(moving) + dispatch.started → 궤적 시간이 지나면 dispatch · alert = arrived, 로봇 자세 = 궤적 끝
 *   로봇이 못 가면(충전 · 점검 · 연결 끊김 · 다른 출동 · 구역 불명 · 경로 없음 · 도달 실패) 알림은 no_robot = 사람 출동 필요
 */
@Injectable()
export class DispatchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Dispatch');
  private active: Active | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SCENE) private readonly scene: Scene,
    @Inject(SETTINGS) private readonly s: Settings,
    private readonly compute: ComputeClient,
    private readonly events: EventsService,
  ) {}

  /** 지금 출동할 수 없는 이유 (출동 중인지는 빼고). null 이면 출동할 수 있다 */
  async blockedReason(q: Queryable, zone: string | null): Promise<string | null> {
    if (!zone) return '구역 불명';
    const robot = await this.robotRow(q);
    if (robot.mode !== 'ready') return ROBOT_MODE_LABEL[robot.mode];
    if (!this.compute.current().ok && !this.precomputed({ x: robot.pose_x, y: robot.pose_y, yaw: robot.pose_yaw_rad }, zone)) {
      return '경로 없음';
    }
    return null;
  }

  /** 출동 자리를 잡는다 (동시에 두 알림이 와도 하나만). 이미 출동 중이면 null */
  reserve(zone: string): Active | null {
    if (this.active) return null;
    this.active = { alertId: -1, zone, dispatchId: null, plan: null, sim: null, startedAt: null, timer: null, cancelled: false };
    return this.active;
  }

  /** 알림을 저장한 뒤 출발 (계산 · 주행은 비동기: 응답은 바로 돌려준다) */
  launch(a: Active, alertId: number): void {
    a.alertId = alertId;
    void this.run(a).catch((e: unknown) => this.abort(a, e));
  }

  /** 자리만 잡고 알림 저장이 실패했을 때 */
  unreserve(a: Active): void {
    this.release(a);
  }

  /** 알림이 끝나면(처리 완료 · 오탐 해제) 가는 중인 출동을 멈춘다. DB 정리는 부른 쪽 트랜잭션이 한다 */
  stopFor(alertId: number): boolean {
    const a = this.active;
    if (!a || a.alertId !== alertId) return false;
    a.cancelled = true;
    this.release(a);
    return true;
  }

  /** 데모 리셋: 진행 중인 출동을 멈춘다 (새 회차로 넘어가므로 DB 는 그대로 둔다) */
  cancelActive(): void {
    const a = this.active;
    if (!a) return;
    a.cancelled = true;
    this.release(a);
  }

  get busy(): boolean {
    return this.active !== null;
  }

  async robotView(q: Queryable = this.db): Promise<RobotDto> {
    const r = await this.robotRow(q);
    const a = this.active;
    const base = {
      id: r.id,
      home: [r.home_x, r.home_y] as [number, number],
      mode: r.mode,
      battery: r.battery,
      available: r.mode === 'ready' && !a,
    };
    if (a?.sim && a.startedAt !== null) {
      const elapsed = Math.min(a.sim.duration_s, ((Date.now() - a.startedAt) / 1000) * this.s.dispatchSpeed);
      const [x, y, yaw] = sampleTrajectory(a.sim.trajectory, elapsed);
      return {
        ...base,
        x: round(x, 3),
        y: round(y, 3),
        yaw: round(yaw, 3),
        state: 'moving',
        etaS: Math.max(0, Math.ceil(a.sim.duration_s - elapsed)),
      };
    }
    // 마지막 출동이 도착했고 그 알림이 아직 열려 있으면 '현장 도착'
    const [last] = await q.query<{ status: string; alert_status: string }>(
      'SELECT d.status, a.status AS alert_status FROM dispatch d JOIN alert a ON a.id = d.alert_id ORDER BY d.id DESC LIMIT 1',
    );
    const arrived = last?.status === 'arrived' && last.alert_status === 'arrived';
    return { ...base, x: r.pose_x, y: r.pose_y, yaw: r.pose_yaw_rad, state: arrived ? 'arrived' : 'idle', etaS: arrived ? 0 : null };
  }

  async setMode(mode: RobotMode) {
    if (!ROBOT_MODES.includes(mode)) throw new BadRequestException('알 수 없는 로봇 상태예요');
    await this.db.tx(async (q) => {
      await q.query('UPDATE robot SET mode = $2 WHERE id = $1', [this.scene.robot.id, mode]);
      await this.events.log(q, {
        type: 'robot.mode',
        actor: '관리자',
        text: `로봇 상태 → ${ROBOT_MODE_LABEL[mode]}`,
        payload: { mode },
      });
    });
    const r = await this.robotView();
    return { mode: r.mode, battery: r.battery, available: r.available };
  }

  /** 서버 재시작: 이동 중이던 출동을 끝 시각에 맞춰 마무리하거나 타이머를 다시 건다 */
  async onApplicationBootstrap() {
    const rows = await this.db.query<DispatchRow>(
      `SELECT id, alert_id, goal_zone_id, computed, status, start_x, start_y, start_yaw_rad, goal_x, goal_y,
              snapped, path, trajectory, reached, duration_s, distance_m,
              extract(epoch FROM now() - started_at)::float8 AS since_s
         FROM dispatch WHERE status IN ('planning', 'moving') ORDER BY id`,
    );
    for (const r of rows) {
      const a: Active = {
        alertId: r.alert_id,
        zone: r.goal_zone_id,
        dispatchId: r.id,
        plan: {
          computed: r.computed,
          start: { x: r.start_x, y: r.start_y, yaw: r.start_yaw_rad },
          path: r.path,
          goal: [r.goal_x, r.goal_y],
          snapped: r.snapped,
        },
        sim: null,
        startedAt: null,
        timer: null,
        cancelled: false,
      };
      if (r.status === 'planning' || !r.trajectory) {
        await this.giveUp(a, '서버 재시작으로 경로 계산이 끊김'); // 궤적이 없어 이어 갈 수 없다
        continue;
      }
      a.sim = { trajectory: r.trajectory, reached: r.reached ?? false, duration_s: r.duration_s ?? 0, distance_m: r.distance_m ?? 0 };
      const since = r.since_s ?? 0;
      a.startedAt = Date.now() - since * 1000;
      const remaining = (a.sim.duration_s * 1000) / this.s.dispatchSpeed - since * 1000;
      if (remaining <= 0 || this.active) {
        await this.arrive(a);
        this.log.log(`재시작 복구: 출동 ${r.id} 은 끝 시각이 지나 마무리했습니다`);
        continue;
      }
      this.active = a;
      this.schedule(a, remaining);
      this.log.log(`재시작 복구: 출동 ${r.id} 이어서 주행 (남은 ${(remaining / 1000).toFixed(1)}초)`);
    }
  }

  onModuleDestroy() {
    const a = this.active;
    if (a) {
      a.cancelled = true; // DB 는 그대로 둔다: 다시 켜면 위의 복구가 이어 간다
      if (a.timer) clearTimeout(a.timer);
    }
  }

  // ── 흐름 ──────────────────────────────────────────────────────

  private async run(a: Active) {
    const pose = await this.robotPose();
    const live = await this.compute.route(a.zone, pose);
    this.check(a);
    if (live) {
      await this.planned(a, { computed: 'live', start: pose, ...live });
      const sim = await this.compute.simulate(pose, live.path);
      this.check(a);
      if (sim) return this.started(a, sim);
      // 경로는 받았는데 궤적이 없다 → 사전 계산표로 바꿔 탄다 (기록에 그대로 남긴다)
      const pre = this.precomputed(pose, a.zone);
      if (!pre) return this.giveUp(a, '경로 계산 실패');
      this.log.warn(`출동 ${a.dispatchId}: /simulate 실패 → 사전 계산표`);
      return this.started(a, pre.sim, pre.plan, 'simulate');
    }
    const pre = this.precomputed(pose, a.zone);
    if (!pre) return this.giveUp(a, '경로 없음');
    await this.planned(a, pre.plan);
    this.check(a);
    await this.started(a, pre.sim);
  }

  /** 출동 행 (planning). 그 사이 알림이 끝났으면 그만둔다 */
  private async planned(a: Active, plan: Plan) {
    a.dispatchId = await this.db.tx(async (q) => {
      const [al] = await q.query<{ status: string }>('SELECT status FROM alert WHERE id = $1 FOR UPDATE', [a.alertId]);
      if (al?.status !== 'dispatched') throw new Cancelled();
      const [d] = await q.query<{ id: number }>(
        `INSERT INTO dispatch (alert_id, robot_id, scan_id, goal_zone_id, computed,
                               start_x, start_y, start_yaw_rad, goal_x, goal_y, snapped, path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb) RETURNING id`,
        [
          a.alertId, this.scene.robot.id, this.scene.scan.id, a.zone, plan.computed,
          plan.start.x, plan.start.y, plan.start.yaw, plan.goal[0], plan.goal[1], plan.snapped, json(plan.path),
        ],
      );
      return d.id;
    });
    a.plan = plan;
  }

  /** planning → moving + dispatch.started. replan = 사전 계산표로 바꿔 탄 경우 */
  private async started(a: Active, sim: Simulation, replan?: Plan, fallback?: string) {
    const plan = replan ?? a.plan!;
    const ok = await this.db.tx(async (q) => {
      const up = await q.query(
        `UPDATE dispatch SET status = 'moving', trajectory = $2::jsonb, reached = $3, duration_s = $4, distance_m = $5,
                             started_at = now(), computed = $6, start_x = $7, start_y = $8, start_yaw_rad = $9,
                             goal_x = $10, goal_y = $11, snapped = $12, path = $13::jsonb
          WHERE id = $1 AND status = 'planning' RETURNING id`,
        [
          a.dispatchId, json(sim.trajectory), sim.reached, sim.duration_s, sim.distance_m, plan.computed,
          plan.start.x, plan.start.y, plan.start.yaw, plan.goal[0], plan.goal[1], plan.snapped, json(plan.path),
        ],
      );
      if (!up.length) return false;
      await this.events.log(q, {
        type: 'dispatch.started',
        actor: 'system',
        text: `로봇 출동 → ${a.zone} (${plan.computed === 'live' ? '실시간 계산 경로' : '미리 계산한 경로'})`,
        alert_id: a.alertId,
        dispatch_id: a.dispatchId,
        payload: { eta_s: sim.duration_s, computed: plan.computed, waypoints: plan.path.length, fallback },
      });
      return true;
    });
    if (!ok) throw new Cancelled();
    a.plan = plan;
    a.sim = sim;
    a.startedAt = Date.now();
    this.schedule(a, (sim.duration_s * 1000) / this.s.dispatchSpeed);
  }

  /** 궤적 끝: 도착이면 arrived, 도달 실패면 사람 출동 필요(no_robot). 로봇 자세 = 궤적 끝 */
  private async arrive(a: Active) {
    const sim = a.sim!;
    const end = sim.trajectory[sim.trajectory.length - 1];
    await this.db.tx(async (q) => {
      const up = await q.query(
        "UPDATE dispatch SET status = $2, ended_at = now() WHERE id = $1 AND status = 'moving' RETURNING id",
        [a.dispatchId, sim.reached ? 'arrived' : 'failed'],
      );
      if (!up.length) return; // 그 사이 알림이 끝나 멈췄다
      if (sim.reached) {
        await q.query("UPDATE alert SET status = 'arrived' WHERE id = $1 AND status = 'dispatched'", [a.alertId]);
      } else {
        await q.query(
          "UPDATE alert SET status = 'no_robot', robot_unavailable = '도달 실패 (경로 막힘)' WHERE id = $1 AND status = 'dispatched'",
          [a.alertId],
        );
      }
      await q.query('UPDATE robot SET pose_x = $2, pose_y = $3, pose_yaw_rad = $4, pose_at = now() WHERE id = $1', [
        this.scene.robot.id, end[1], end[2], end[3],
      ]);
      await this.events.log(q, {
        type: sim.reached ? 'dispatch.arrived' : 'dispatch.failed',
        actor: 'system',
        text: sim.reached
          ? `로봇 ${a.zone} 도착 (${sim.duration_s.toFixed(1)}초)`
          : `로봇 ${a.zone} 도달 실패 (경로 막힘) — 사람 출동 필요`,
        alert_id: a.alertId,
        dispatch_id: a.dispatchId,
        payload: { reached: sim.reached, duration_s: sim.duration_s, distance_m: sim.distance_m },
      });
    });
    this.release(a);
  }

  /** 로봇이 갈 수 없다: 알림 → 사람 출동 필요(no_robot) + dispatch.unavailable */
  private async giveUp(a: Active, reason: string) {
    await this.db.tx(async (q) => {
      if (a.dispatchId !== null) {
        await q.query(
          "UPDATE dispatch SET status = 'failed', ended_at = now() WHERE id = $1 AND status IN ('planning', 'moving')",
          [a.dispatchId],
        );
      }
      const up = await q.query(
        "UPDATE alert SET status = 'no_robot', robot_unavailable = $2 WHERE id = $1 AND status = 'dispatched' RETURNING id",
        [a.alertId, reason],
      );
      if (!up.length) return;
      await this.events.log(q, {
        type: 'dispatch.unavailable',
        actor: 'system',
        text: `로봇 출동 불가 (${reason}) — 사람 출동 필요`,
        alert_id: a.alertId,
        dispatch_id: a.dispatchId,
        payload: { reason },
      });
    });
    this.release(a);
  }

  private async abort(a: Active, e: unknown) {
    if (!(e instanceof Cancelled) && !a.cancelled) {
      this.log.error(`출동 처리 중 오류 (알림 ${a.alertId}): ${(e as Error)?.message ?? String(e)}`);
      await this.giveUp(a, '서버 오류').catch((e2: unknown) => this.log.error(`실패 기록도 못 남겼습니다: ${(e2 as Error)?.message}`));
    }
    this.release(a);
  }

  // ── 도우미 ────────────────────────────────────────────────────

  private check(a: Active) {
    if (a.cancelled) throw new Cancelled();
  }

  private schedule(a: Active, ms: number) {
    a.timer = setTimeout(() => void this.arrive(a).catch((e: unknown) => this.abort(a, e)), Math.max(0, ms));
    a.timer.unref();
  }

  private release(a: Active) {
    if (a.timer) clearTimeout(a.timer);
    a.timer = null;
    if (this.active === a) this.active = null;
  }

  private async robotRow(q: Queryable) {
    const [r] = await q.query<{
      id: string;
      home_x: number;
      home_y: number;
      home_yaw_rad: number;
      pose_x: number;
      pose_y: number;
      pose_yaw_rad: number;
      mode: RobotMode;
      battery: number;
    }>('SELECT id, home_x, home_y, home_yaw_rad, pose_x, pose_y, pose_yaw_rad, mode, battery FROM robot WHERE id = $1', [
      this.scene.robot.id,
    ]);
    return r;
  }

  private async robotPose(): Promise<Pose> {
    const r = await this.robotRow(this.db);
    return { x: r.pose_x, y: r.pose_y, yaw: r.pose_yaw_rad };
  }

  /** 사전 계산표: 로봇 자세에서 가장 가까운 출발점 → 구역 */
  private precomputed(pose: Pose, zone: string): { plan: Plan; sim: Simulation } | null {
    const table = this.scene.routes;
    if (!table) return null;
    let key: string | null = null;
    let best = Infinity;
    for (const [k, p] of Object.entries(table.starts)) {
      const d = Math.hypot(p.x - pose.x, p.y - pose.y);
      if (d < best) {
        best = d;
        key = k;
      }
    }
    if (key === null) return null;
    const start = table.starts[key];
    if (best > 0.5) this.log.warn(`사전 계산표: 로봇이 가장 가까운 출발점(${key})에서 ${best.toFixed(2)}m 떨어져 있습니다`);
    if (key === zone) {
      // 이미 그 구역에 서 있다: 움직이지 않는 출동
      return {
        plan: { computed: 'precomputed', start, path: [[start.x, start.y]], goal: [start.x, start.y], snapped: false },
        sim: { trajectory: [[0, start.x, start.y, start.yaw]], reached: true, duration_s: 0, distance_m: 0 },
      };
    }
    const r = table.routes.find((x) => x.from === key && x.to === zone);
    if (!r) return null;
    return {
      plan: { computed: 'precomputed', start, path: r.path, goal: r.goal, snapped: r.snapped },
      sim: { trajectory: r.trajectory, reached: r.reached, duration_s: r.duration_s, distance_m: r.distance_m },
    };
  }
}
