import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { type LocateParams, normalizeBeaconId, SCENE, type Scene } from '../config/scene.js';

/** in = 수신기 구역 안 · out = 신호는 오지만 기준보다 약함(구역 밖) · unknown = 신호가 없음 */
export type PresenceState = 'in' | 'out' | 'unknown';

export interface PresenceDto {
  deviceId: string;
  label: string;
  beaconId: string | null;
  state: PresenceState;
  zoneId: string | null;
  gatewayId: string | null;
  /** 판정에 쓴 RSSI 중앙값 (dBm). 안이면 그 수신기, 아니면 가장 센 수신기 */
  rssi: number | null;
  /** 지금 상태가 된 시각 (같은 구역의 다른 수신기로 바뀌는 건 그대로) */
  since: Date | null;
  lastSeen: Date | null;
  /** 들어옴 · 나감 · 바뀜을 확정하기 전 기다리는 중 (현장 보정 화면용) */
  pending: { kind: 'enter' | 'switch' | 'exit'; gatewayId: string | null; forS: number } | null;
  /**
   * 바닥 위치 (m, 구역 · 태그 · 로봇과 같은 좌표) · 오차 반지름. 수신기 두 대가 들을 때만 (아니면 null).
   * 신호 세기로 어림잡은 값이라 실내에서 ±50% 정도 틀린다 — 메모리 계산만, 기록하지 않는다
   */
  position: { x: number; y: number; err: number } | null;
}

export interface GatewayDto {
  id: string;
  zoneId: string;
  label: string;
  /** 바닥 위치 (m) — 씬 world */
  x: number;
  y: number;
  /** timeout_s 안에 보고가 왔나 */
  online: boolean;
  lastReportAt: Date | null;
  /** 거리 어림에 쓰는 1m 세기 (관리자 화면 · 1m 보정 > 씬). null = 비콘이 알린 값 */
  ref1mDbm: number | null;
}

/** 수신기 하나에서 본 비콘까지 어림 거리 */
export interface RangeDto {
  gatewayId: string;
  /** 최근 3초 상위 25% 지점 (dBm) */
  rssi: number;
  /** m — 실내에서는 ±50% 정도 틀린다 */
  distance: number;
}

/** 1m 보정: 수신기에서 지금 잰 세기 (저장은 GatewaySettings) */
export interface Ref1mDto {
  gatewayId: string;
  ref1mDbm: number;
  deviceId: string;
  label: string;
  samples: number;
}

/** 레이더 (수신기 하나 기준, m): x = 오른쪽, y = 앞 (구역 쪽) */
export interface RadarDto {
  gatewayId: string;
  zoneId: string;
  /** 이 수신기 구역의 바닥 사각형 */
  zone: { id: string; name: string; polygon: [number, number][] } | null;
  /** 다른 수신기 */
  receivers: { id: string; label: string; x: number; y: number; online: boolean }[];
  blips: {
    deviceId: string;
    label: string;
    beaconId: string | null;
    state: PresenceState;
    zoneId: string | null;
    /** 이 수신기까지 어림 거리. 위치를 알면 그 위치까지, 이 수신기가 못 들으면 null */
    distance: number | null;
    /** 수신기 두 대 이상이 들으면 위치 · 오차 반지름 (아니면 null — 거리만) */
    x: number | null;
    y: number | null;
    err: number | null;
    /** 이 수신기에서의 세기 */
    rssi: number | null;
    /** 최근 3초 안에 들은 수신기 */
    heardBy: string[];
  }[];
}

interface Sample {
  at: number;
  rssi: number;
}

interface Track {
  links: Map<string, Sample[]>; // 수신기 id → 최근 신호
  state: PresenceState;
  gatewayId: string | null;
  since: number | null;
  pending: { kind: 'enter' | 'switch' | 'exit'; gatewayId: string | null; since: number } | null;
}

type Gateway = Scene['gateways'][number];
interface Point {
  x: number;
  y: number;
}

/** 비콘이 기준을 안 알렸고 보정도 안 했을 때의 1m 세기 (iBeacon 관례값) */
const DEFAULT_REF_1M = -59;
/** 거리 어림: 최근 3초 · 상위 25% 지점 — 반사 · 가림으로 뚝 떨어진 값보다 센 쪽이 덜 흔들린다 */
const RANGE_MS = 3000;
const RANGE_Q = 0.75;
/** 위치 계산에 쓰는 두 수신기 사이 최소 거리 (m) */
const MIN_BASELINE = 0.3;
/** 위치가 따라가는 시간 상수 · 이보다 오래 끊기면 새로 잡는다 (ms) */
const FIX_TAU_MS = 1500;
const FIX_RESET_MS = 5000;

const median = (v: number[]) => quantile(v, 0.5);
const quantile = (v: number[], q: number) => {
  const s = [...v].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
// + 0: -0 을 0 으로 (화면 · 비교에서 헷갈리지 않게)
const round1 = (v: number) => Math.round(v * 10) / 10 + 0;
const round2 = (v: number) => Math.round(v * 100) / 100 + 0;
const at2 = (g: Gateway): Point => ({ x: g.world[0], y: g.world[1] });
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * 헬멧 비콘이 어느 수신기 구역에 있는지 · 레이더 위치 (서버 메모리만 — 위치 이력은 남기지 않는다).
 *
 * 구역: 수신기마다 최근 window_s 의 RSSI 중앙값을 보고
 *   들어옴 — 가장 센 수신기가 enter_dbm 이상인 채로 hold_s
 *   나감   — 지금 수신기가 enter_dbm - exit_margin_db 보다 약한 채로 hold_s (문턱 근처에서 깜빡이지 않게 여유를 둔다)
 *   바뀜   — 다른 수신기가 switch_db 이상 센 채로 hold_s (수신기가 여러 대일 때)
 *   알 수 없음 — timeout_s 동안 어떤 수신기에도 안 들림
 *
 * 레이더: 수신기마다 RSSI → 어림 거리 (d = 10^((1m 세기 − RSSI) / (10·n)))
 *   한 대만 들으면 거리만, 두 대가 들으면 두 거리 원이 만나는 점 = 위치. 점이 둘(기준선 양쪽)이면 구역 쪽을 고른다
 *   → 수신기 두 대는 구역 한쪽 끝에 나란히 두고 구역을 바라보게 한다.
 */
@Injectable()
export class LocateService {
  /** 시계 (ms). 테스트에서 바꿔 끼운다 */
  now: () => number = () => Date.now();

  private readonly tracks = new Map<string, Track>();
  private readonly reported = new Map<string, number>();
  private readonly unknown = new Map<string, { beaconId: string; gatewayId: string; rssi: number; at: number }>();
  private readonly byBeacon: Map<string, string>;
  /** 비콘이 알린 1m 세기 (iBeacon txPower) */
  private readonly txPower = new Map<string, number>();
  /** 레이더 위치 (부드럽게 한 값). 메모리만 */
  private readonly fixes = new Map<string, Point & { at: number }>();

  constructor(@Inject(SCENE) private readonly scene: Scene) {
    this.byBeacon = new Map(scene.devices.filter((d) => d.beaconId).map((d) => [d.beaconId!, d.id]));
  }

  get params(): LocateParams {
    return this.scene.locate;
  }

  /** 수신기 보고 (1초마다). 돌려주는 것 = 이번 보고에 들린 단말의 판정 (수신기 화면에 보여 준다) */
  ingest(gatewayId: string, readings: { beaconId: string; rssi: number[]; txPower?: number }[]): PresenceDto[] {
    this.gatewayOrThrow(gatewayId);
    const t = this.now();
    this.reported.set(gatewayId, t);
    const touched = new Set<string>();
    for (const r of readings) {
      // 대소문자 · 앞자리 0 이 달라도 같은 비콘 (형식이 아니면 그대로 — 보정 화면에서 보이게)
      const beaconId = normalizeBeaconId(r.beaconId) ?? r.beaconId.trim().toLowerCase();
      const values = r.rssi.filter((v) => Number.isFinite(v) && v < 0 && v > -130);
      if (!values.length) continue;
      if (r.txPower !== undefined && Number.isFinite(r.txPower) && r.txPower < 0 && r.txPower >= -128) {
        this.txPower.set(beaconId, r.txPower);
      }
      const deviceId = this.byBeacon.get(beaconId);
      if (!deviceId) {
        // 등록 안 된 비콘: 판정에는 안 쓰고, 현장 보정 화면에서 보이게만 (번호를 잘못 넣었을 때 찾기 쉽게)
        this.unknown.set(`${gatewayId}|${beaconId}`, { beaconId, gatewayId, rssi: median(values), at: t });
        continue;
      }
      const track = this.track(deviceId);
      const samples = track.links.get(gatewayId) ?? [];
      for (const v of values) samples.push({ at: t, rssi: v });
      track.links.set(gatewayId, samples);
      touched.add(deviceId);
    }
    this.prune(t);
    return [...touched].map((d) => this.evaluate(d, t));
  }

  /** 모든 단말의 지금 판정 (관제 폴링) */
  presence(): PresenceDto[] {
    const t = this.now();
    return this.scene.devices.map((d) => this.evaluate(d.id, t));
  }

  /** 쓰러짐 알림의 구역: 지금 '안'이면 그 수신기의 구역 */
  zoneOf(deviceId: string): { zoneId: string; gatewayId: string; rssi: number | null } | null {
    if (!this.scene.devices.some((d) => d.id === deviceId)) return null;
    const p = this.evaluate(deviceId, this.now());
    return p.state === 'in' && p.zoneId && p.gatewayId ? { zoneId: p.zoneId, gatewayId: p.gatewayId, rssi: p.rssi } : null;
  }

  gateways(): GatewayDto[] {
    const t = this.now();
    return this.scene.gateways.map((g) => {
      const at = this.reported.get(g.id) ?? null;
      return {
        id: g.id,
        zoneId: g.zone,
        label: g.label,
        x: g.world[0],
        y: g.world[1],
        online: this.online(g.id, t),
        lastReportAt: at === null ? null : new Date(at),
        ref1mDbm: g.ref1mDbm ?? this.params.ref1mDbm,
      };
    });
  }

  /** 레이더: 이 수신기 기준으로 본 단말들 (수신기 두 대 이상이 들으면 위치까지) */
  radar(gatewayId: string): RadarDto {
    const g = this.gatewayOrThrow(gatewayId);
    const t = this.now();
    const o = at2(g);
    const f = this.front(g);
    const r = { x: -f.y, y: f.x }; // 위에서 본 바닥(x 오른쪽 · y 아래)에서 f 를 바라볼 때 오른쪽
    const rel = (p: Point): [number, number] => {
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      return [round2(dx * r.x + dy * r.y), round2(dx * f.x + dy * f.y)];
    };
    const zone = this.scene.zones.find((z) => z.id === g.zone);
    const rect = zone?.rect ?? null;
    return {
      gatewayId: g.id,
      zoneId: g.zone,
      zone:
        zone && rect
          ? {
              id: zone.id,
              name: zone.name,
              polygon: [
                rel({ x: rect[0], y: rect[1] }),
                rel({ x: rect[0] + rect[2], y: rect[1] }),
                rel({ x: rect[0] + rect[2], y: rect[1] + rect[3] }),
                rel({ x: rect[0], y: rect[1] + rect[3] }),
              ],
            }
          : null,
      receivers: this.scene.gateways
        .filter((x) => x.id !== g.id)
        .map((x) => {
          const [rx, ry] = rel(at2(x));
          return { id: x.id, label: x.label, x: rx, y: ry, online: this.online(x.id, t) };
        }),
      blips: this.scene.devices.flatMap((d) => {
        const ranges = this.ranges(d.id, t);
        if (!ranges.length) return [];
        const p = this.evaluate(d.id, t);
        const mine = ranges.find((x) => x.gatewayId === g.id);
        const fix = this.position(d.id, t);
        const xy = fix ? rel(fix) : null;
        return [
          {
            deviceId: d.id,
            label: d.label,
            beaconId: d.beaconId,
            state: p.state,
            zoneId: p.zoneId,
            distance: xy ? round2(Math.hypot(xy[0], xy[1])) : mine ? round2(mine.distance) : null,
            x: xy ? xy[0] : null,
            y: xy ? xy[1] : null,
            err: fix ? round2(fix.err) : null,
            rssi: mine ? round1(mine.rssi) : null,
            heardBy: ranges.map((x) => x.gatewayId),
          },
        ];
      }),
    };
  }

  /**
   * 1m 보정용 측정: 이 수신기에서 지금 가장 세게 들리는(또는 고른) 비콘의 최근 3초 세기 (거리와 같은 상위 25% 지점).
   * 재기만 한다 — '1m 세기'로 저장하는 건 GatewaySettings (관리자 화면에서도 보인다)
   */
  measureRef1m(gatewayId: string, beaconId?: string): Ref1mDto {
    const g = this.gatewayOrThrow(gatewayId);
    const t = this.now();
    const want = beaconId ? (normalizeBeaconId(beaconId) ?? beaconId.trim().toLowerCase()) : null;
    const best = this.scene.devices
      .filter((d) => d.beaconId && (!want || d.beaconId === want))
      .flatMap((d) => {
        const recent = (this.tracks.get(d.id)?.links.get(g.id) ?? []).filter((s) => t - s.at <= RANGE_MS).map((s) => s.rssi);
        return recent.length >= 5 ? [{ device: d, rssi: quantile(recent, RANGE_Q), samples: recent.length }] : [];
      })
      .sort((a, b) => b.rssi - a.rssi)[0];
    if (!best) {
      throw new BadRequestException(
        `${g.label}에 최근 3초 동안 들린 비콘이 없어요. 비콘을 수신기 1m 앞에 두고 2~3초 뒤 다시 해 주세요`,
      );
    }
    return { gatewayId: g.id, ref1mDbm: round1(best.rssi), deviceId: best.device.id, label: best.device.label, samples: best.samples };
  }

  /** 현장 보정용: 판정 값 · 수신기별 중앙값과 표본 수 · 어림 거리 · 위치 · 등록 안 된 비콘 */
  debug() {
    const t = this.now();
    const W = this.params.windowS * 1000;
    return {
      now: new Date(t),
      params: this.params,
      gateways: this.gateways(),
      devices: this.scene.devices.map((d) => {
        const track = this.track(d.id);
        const fix = this.position(d.id, t);
        return {
          ...this.evaluate(d.id, t),
          links: [...track.links].map(([gatewayId, samples]) => {
            const recent = samples.filter((s) => t - s.at <= W).map((s) => s.rssi);
            return {
              gatewayId,
              median: recent.length ? round1(median(recent)) : null,
              count: recent.length,
              lastAt: samples.length ? new Date(samples[samples.length - 1].at) : null,
            };
          }),
          ranges: this.ranges(d.id, t).map((x) => ({ ...x, rssi: round1(x.rssi), distance: round2(x.distance) })),
          position: fix ? { x: round2(fix.x), y: round2(fix.y), err: round2(fix.err), gateways: fix.pair } : null,
        };
      }),
      unknownBeacons: [...this.unknown.values()].map((u) => ({ ...u, rssi: round1(u.rssi), at: new Date(u.at) })),
    };
  }

  // ── 거리 · 위치 ───────────────────────────────────────────────

  private gatewayOrThrow(gatewayId: string): Gateway {
    const g = this.scene.gateways.find((x) => x.id === gatewayId);
    if (!g) throw new BadRequestException(`등록되지 않은 수신기예요: ${gatewayId} (demo.json 의 gateways 를 확인해 주세요)`);
    return g;
  }

  private online(gatewayId: string, t: number): boolean {
    const at = this.reported.get(gatewayId);
    return at !== undefined && t - at <= this.params.timeoutS * 1000;
  }

  /** 1m 세기: 수신기 값(관리자 화면 · 1m 보정 > 씬) > 공통 locate.ref_1m_dbm > 비콘이 알린 값 > -59 */
  private ref1m(g: Gateway, beaconId: string | null): number {
    return (
      g.ref1mDbm ??
      this.params.ref1mDbm ??
      (beaconId ? this.txPower.get(beaconId) : undefined) ??
      DEFAULT_REF_1M
    );
  }

  /** 단말까지 수신기별 어림 거리 (가까운 순서 — 수신기마다 1m 세기가 달라 '센 순서'와 다를 수 있다) */
  private ranges(deviceId: string, t: number): RangeDto[] {
    const track = this.tracks.get(deviceId);
    const device = this.scene.devices.find((d) => d.id === deviceId);
    if (!track || !device) return [];
    const out: RangeDto[] = [];
    for (const [gatewayId, samples] of track.links) {
      const g = this.scene.gateways.find((x) => x.id === gatewayId);
      const recent = samples.filter((s) => t - s.at <= RANGE_MS).map((s) => s.rssi);
      if (!g || !recent.length) continue;
      const rssi = quantile(recent, RANGE_Q);
      const distance = Math.min(50, Math.max(0.1, 10 ** ((this.ref1m(g, device.beaconId) - rssi) / (10 * this.params.pathLossN))));
      out.push({ gatewayId, rssi, distance });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  /** 구역 사각형 가운데 */
  private zoneCenter(zoneId: string): Point | null {
    const rect = this.scene.zones.find((z) => z.id === zoneId)?.rect;
    return rect ? { x: rect[0] + rect[2] / 2, y: rect[1] + rect[3] / 2 } : null;
  }

  /** 기준선(u)에 수직인 두 방향 중 구역 가운데 쪽 */
  private side(u: Point, from: Point, center: Point | null): Point {
    const n = { x: -u.y, y: u.x };
    if (!center) return n;
    return (center.x - from.x) * n.x + (center.y - from.y) * n.y >= 0 ? n : { x: -n.x, y: -n.y };
  }

  /** 레이더의 '앞': 가장 가까운 다른 수신기와의 기준선에 수직인 구역 쪽 → 없으면 구역 가운데 쪽 → 바닥 위쪽 */
  private front(g: Gateway): Point {
    const o = at2(g);
    const other = this.scene.gateways
      .filter((x) => x.id !== g.id && dist(o, at2(x)) >= MIN_BASELINE)
      .sort((a, b) => dist(o, at2(a)) - dist(o, at2(b)))[0];
    const center = this.zoneCenter(g.zone);
    if (other) {
      const p = at2(other);
      const b = dist(o, p);
      return this.side({ x: (p.x - o.x) / b, y: (p.y - o.y) / b }, o, center);
    }
    if (center && dist(o, center) > 1e-6) {
      const b = dist(o, center);
      return { x: (center.x - o.x) / b, y: (center.y - o.y) / b };
    }
    return { x: 0, y: -1 };
  }

  /** 위치: 가장 가까운 수신기 + 그다음으로 가까운(자리가 다른) 수신기의 거리 원이 만나는 점 (구역 쪽) */
  private position(deviceId: string, t: number): (Point & { err: number; pair: [string, string] }) | null {
    const ranges = this.ranges(deviceId, t);
    const g1 = ranges.length ? this.scene.gateways.find((x) => x.id === ranges[0].gatewayId) : undefined;
    const second = g1
      ? ranges.slice(1).find((x) => {
          const g = this.scene.gateways.find((y) => y.id === x.gatewayId);
          return g !== undefined && dist(at2(g), at2(g1)) >= MIN_BASELINE;
        })
      : undefined;
    const g2 = second ? this.scene.gateways.find((x) => x.id === second.gatewayId) : undefined;
    if (!g1 || !second || !g2) {
      this.fixes.delete(deviceId);
      return null;
    }
    const p1 = at2(g1);
    const b = dist(p1, at2(g2));
    const u = { x: (g2.world[0] - p1.x) / b, y: (g2.world[1] - p1.y) / b };
    const n = this.side(u, p1, this.zoneCenter(g1.zone));
    const d1 = ranges[0].distance;
    const d2 = second.distance;
    // 기준선 위 거리 x · 기준선에서 떨어진 거리 h. 잡음으로 원이 안 만나면 기준선 위(가장 가까운 점)
    const x = (d1 * d1 - d2 * d2 + b * b) / (2 * b);
    const h = Math.sqrt(Math.max(0, d1 * d1 - x * x));
    const raw = { x: p1.x + u.x * x + n.x * h, y: p1.y + u.y * x + n.y * h };

    const prev = this.fixes.get(deviceId);
    let p = raw;
    if (prev && t - prev.at <= FIX_RESET_MS) {
      const a = 1 - Math.exp(-(t - prev.at) / FIX_TAU_MS);
      p = { x: prev.x + a * (raw.x - prev.x), y: prev.y + a * (raw.y - prev.y) };
    }
    this.fixes.set(deviceId, { ...p, at: t });
    return { ...p, err: 0.3 + (0.35 * (d1 + d2)) / 2, pair: [g1.id, g2.id] };
  }

  // ── 판정 ──────────────────────────────────────────────────────

  private track(deviceId: string): Track {
    let track = this.tracks.get(deviceId);
    if (!track) {
      track = { links: new Map(), state: 'unknown', gatewayId: null, since: null, pending: null };
      this.tracks.set(deviceId, track);
    }
    return track;
  }

  private prune(t: number) {
    const keep = Math.max(this.params.windowS * 1000, this.params.timeoutS * 1000, RANGE_MS) + 1000;
    for (const track of this.tracks.values()) {
      for (const [g, samples] of track.links) {
        const fresh = samples.filter((s) => t - s.at <= keep);
        if (fresh.length) track.links.set(g, fresh);
        else track.links.delete(g);
      }
    }
    for (const [k, u] of this.unknown) if (t - u.at > 30_000) this.unknown.delete(k);
  }

  private evaluate(deviceId: string, t: number): PresenceDto {
    const device = this.scene.devices.find((d) => d.id === deviceId)!;
    const track = this.track(deviceId);
    const p = this.params;
    const W = p.windowS * 1000;
    const H = p.holdS * 1000;
    const T = p.timeoutS * 1000;
    const zoneOfGateway = (id: string | null) => (id ? (this.scene.gateways.find((g) => g.id === id)?.zone ?? null) : null);

    let lastSeen = 0;
    const med = new Map<string, number>();
    for (const [g, samples] of track.links) {
      if (samples.length) lastSeen = Math.max(lastSeen, samples[samples.length - 1].at);
      const recent = samples.filter((s) => t - s.at <= W).map((s) => s.rssi);
      if (recent.length) med.set(g, median(recent));
    }
    let best: string | null = null;
    let bestRssi = -Infinity;
    for (const [g, m] of med) {
      if (m > bestRssi) {
        best = g;
        bestRssi = m;
      }
    }

    const setState = (state: PresenceState, gatewayId: string | null) => {
      // 같은 구역의 다른 수신기로 바뀌는 건 '그대로' (since 를 새로 잡지 않는다)
      if (track.state !== state || zoneOfGateway(track.gatewayId) !== zoneOfGateway(gatewayId)) track.since = t;
      track.state = state;
      track.gatewayId = gatewayId;
    };
    /** 같은 조건이 hold_s 이어졌나 */
    const held = (kind: 'enter' | 'switch' | 'exit', gatewayId: string | null) => {
      if (!track.pending || track.pending.kind !== kind || track.pending.gatewayId !== gatewayId) {
        track.pending = { kind, gatewayId, since: t };
      }
      return t - track.pending.since >= H;
    };
    const confirm = (state: PresenceState, gatewayId: string | null) => {
      setState(state, gatewayId);
      track.pending = null;
    };

    if (!lastSeen || t - lastSeen > T) {
      confirm('unknown', null);
    } else if (track.state === 'in' && track.gatewayId) {
      const cur = track.gatewayId;
      const curRssi = med.get(cur) ?? -Infinity;
      if (best !== null && best !== cur && bestRssi >= p.enterDbm && bestRssi - curRssi >= p.switchDb) {
        if (held('switch', best)) confirm('in', best);
      } else if (curRssi < p.enterDbm - p.exitMarginDb) {
        if (held('exit', null)) confirm('out', null);
      } else {
        track.pending = null;
      }
    } else {
      if (track.state === 'unknown') setState('out', null); // 다시 들리기 시작했다
      if (best !== null && bestRssi >= p.enterDbm) {
        if (held('enter', best)) confirm('in', best);
      } else {
        track.pending = null;
      }
    }

    const rssi = track.state === 'in' && track.gatewayId ? (med.get(track.gatewayId) ?? null) : Number.isFinite(bestRssi) ? bestRssi : null;
    const fix = this.position(deviceId, t);
    return {
      deviceId,
      label: device.label,
      beaconId: device.beaconId,
      state: track.state,
      zoneId: zoneOfGateway(track.gatewayId),
      gatewayId: track.gatewayId,
      rssi: rssi === null ? null : round1(rssi),
      since: track.since === null ? null : new Date(track.since),
      lastSeen: lastSeen ? new Date(lastSeen) : null,
      pending: track.pending
        ? { kind: track.pending.kind, gatewayId: track.pending.gatewayId, forS: round1((t - track.pending.since) / 1000) }
        : null,
      position: fix ? { x: round2(fix.x), y: round2(fix.y), err: round2(fix.err) } : null,
    };
  }
}
