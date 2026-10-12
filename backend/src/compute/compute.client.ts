import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Pose, TrajPoint, Xy } from '../config/scene.js';
import { SETTINGS, type Settings } from '../config/settings.js';

export interface RoutePlan {
  path: Xy[];
  goal: Xy;
  snapped: boolean;
}

export interface Simulation {
  trajectory: TrajPoint[];
  reached: boolean;
  duration_s: number;
  distance_m: number;
}

export interface ComputeStatus {
  ok: boolean;
  /** live = 계산 서비스가 지금 계산 · precomputed = 사전 계산 모드 (콘솔 구석에 표시) */
  mode: 'live' | 'precomputed';
  url: string | null;
  checked_at: string | null;
  error: string | null;
}

// 기획서 §7-7: route 1초 · simulate 5초. 넘기면 사전 계산표로 대체한다
const TIMEOUT_MS = { health: 1000, route: 1000, simulate: 5000 } as const;
const HEALTH_EVERY_MS = 10_000;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isXy = (v: unknown): v is Xy => Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1]);
const isTraj = (v: unknown): v is TrajPoint => Array.isArray(v) && v.length >= 4 && v.slice(0, 4).every(isNum);

function reason(e: unknown, ms: number): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  if (err?.name === 'TimeoutError') return `${ms}ms 안에 응답 없음`;
  if (err?.cause?.code === 'ECONNREFUSED') return '연결 거부 (계산 서비스가 꺼져 있음)';
  return err?.message ?? String(e);
}

/**
 * 계산 서비스(파이썬 · 127.0.0.1:8766: 경로 계획 + MuJoCo 주행) 호출. 백엔드는 부르기만 한다.
 * 실패하면 null 을 돌려주고, 부른 쪽이 사전 계산표로 대체한다. (best-view 사진은 3D 연동 때)
 */
@Injectable()
export class ComputeClient implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Compute');
  private status: ComputeStatus;
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(SETTINGS) private readonly s: Settings) {
    this.status = { ok: false, mode: 'precomputed', url: s.computeUrl, checked_at: null, error: s.computeUrl ? null : '꺼 둠 (COMPUTE_URL=off)' };
  }

  async onApplicationBootstrap() {
    if (!this.s.computeUrl) return;
    await this.checkHealth();
    this.timer = setInterval(() => void this.checkHealth(), HEALTH_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  current(): ComputeStatus {
    return this.status;
  }

  async checkHealth(): Promise<ComputeStatus> {
    const r = await this.call('GET', '/health', undefined, TIMEOUT_MS.health);
    if (r !== null && (r as { ok?: unknown }).ok !== true) this.mark(false, '/health 가 ok 가 아님');
    return this.status;
  }

  /** 구역까지 경로. pose = [x, y, yaw(rad)] */
  async route(zone: string, pose: Pose): Promise<RoutePlan | null> {
    const r = (await this.call('POST', '/route', { zone, pose: [pose.x, pose.y, pose.yaw] }, TIMEOUT_MS.route)) as
      | { path?: unknown; goal?: unknown; snapped?: unknown }
      | null;
    if (!r) return null;
    if (!Array.isArray(r.path) || !r.path.length || !r.path.every(isXy)) return this.bad('/route', 'path');
    const path = r.path.map((p) => [p[0], p[1]] as Xy);
    return { path, goal: isXy(r.goal) ? [r.goal[0], r.goal[1]] : path[path.length - 1], snapped: r.snapped === true };
  }

  /** 경로를 MuJoCo 로 주행한 궤적 */
  async simulate(pose: Pose, path: Xy[]): Promise<Simulation | null> {
    const r = (await this.call('POST', '/simulate', { pose: [pose.x, pose.y, pose.yaw], path }, TIMEOUT_MS.simulate)) as
      | { trajectory?: unknown; reached?: unknown; duration_s?: unknown; distance_m?: unknown }
      | null;
    if (!r) return null;
    if (!Array.isArray(r.trajectory) || !r.trajectory.length || !r.trajectory.every(isTraj)) {
      return this.bad('/simulate', 'trajectory');
    }
    if (!isNum(r.duration_s) || !isNum(r.distance_m)) return this.bad('/simulate', 'duration_s · distance_m');
    return {
      trajectory: r.trajectory.map((p) => [p[0], p[1], p[2], p[3]] as TrajPoint),
      reached: r.reached === true,
      duration_s: r.duration_s,
      distance_m: r.distance_m,
    };
  }

  private bad(path: string, field: string): null {
    this.log.warn(`${path} 응답 형식이 다릅니다 (${field}) → 대체`);
    return null;
  }

  private mark(ok: boolean, error: string | null = null) {
    if (ok !== this.status.ok || this.status.checked_at === null) {
      if (ok) this.log.log('계산 서비스 응답 → live 모드');
      else this.log.warn(`계산 서비스 응답 없음 → 사전 계산 모드 (${error})`);
    }
    this.status = { ok, mode: ok ? 'live' : 'precomputed', url: this.s.computeUrl, checked_at: new Date().toISOString(), error };
  }

  /** 실패하면 null. 상태가 바뀔 때만 로그를 남긴다 (꺼져 있는 동안 10초마다 찍지 않게) */
  private async call(method: 'GET' | 'POST', path: string, body: unknown, ms: number): Promise<unknown> {
    if (!this.s.computeUrl) return null;
    try {
      const res = await fetch(this.s.computeUrl + path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const data: unknown = await res.json();
      this.mark(true);
      return data;
    } catch (e) {
      this.mark(false, `${path}: ${reason(e, ms)}`);
      return null;
    }
  }
}

