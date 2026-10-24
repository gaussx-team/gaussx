import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const SCENE = 'SCENE';

/** 바닥 좌표 · 미터. 3D 연동 전에는 화면의 4×3m 평면도와 같은 좌표 */
export type Xy = [number, number];
/** [t, x, y, yaw] — 초 · 미터 · 라디안 */
export type TrajPoint = [number, number, number, number];
export interface Pose {
  x: number;
  y: number;
  yaw: number;
}

/** 사전 계산표의 경로 하나 (routes.json) */
export interface Route {
  from: string;
  to: string;
  path: Xy[];
  goal: Xy;
  snapped: boolean;
  trajectory: TrajPoint[];
  reached: boolean;
  duration_s: number;
  distance_m: number;
}

export type DeviceKind = 'phone' | 'helmet_beacon' | 'uwb_tag';

/** 비콘 구역 판정 값 (demo.json "locate"). 현장에서 RSSI 를 재 보고 고친다 */
export interface LocateParams {
  /** 이 시간 안의 RSSI 중앙값으로 판정 (초) */
  windowS: number;
  /** 이 세기 이상이면 '구역 안' (dBm) */
  enterDbm: number;
  /** 안에 있다가 enterDbm 보다 이만큼 약해지면 '밖' — 문턱 근처에서 깜빡이지 않게 (dB) */
  exitMarginDb: number;
  /** 다른 수신기가 이만큼 더 세면 그 구역으로 바뀐다 (dB) */
  switchDb: number;
  /** 들어옴 · 나감 · 바뀜이 이 시간 이어져야 확정 (초) */
  holdS: number;
  /** 이 시간 동안 신호가 없으면 '알 수 없음' (초) */
  timeoutS: number;
  /** 거리 어림(레이더): 감쇠 지수 — 자유 공간 2, 실내 2.5~3.5 */
  pathLossN: number;
  /** 거리 어림: 1m 에서의 세기 (dBm). null 이면 비콘이 알린 값(iBeacon txPower), 그것도 없으면 -59 */
  ref1mDbm: number | null;
}

export const DEFAULT_LOCATE: LocateParams = {
  windowS: 1.5,
  enterDbm: -70,
  exitMarginDb: 6,
  switchDb: 6,
  holdS: 2,
  timeoutS: 4,
  pathLossN: 2.5,
  ref1mDbm: null,
};

/** iBeacon 식별자 "uuid:major:minor" (소문자) */
export const BEACON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{1,5}:[0-9]{1,5}$/;

/** 비콘 id 를 한 모양으로: 소문자 · major · minor 는 앞자리 0 없이 (0~65535). 형식이 아니면 null */
export function normalizeBeaconId(v: string): string | null {
  const t = v.trim().toLowerCase();
  if (!BEACON_ID.test(t)) return null;
  const [uuid, major, minor] = t.split(':');
  const ma = Number(major);
  const mi = Number(minor);
  return ma <= 0xffff && mi <= 0xffff ? `${uuid}:${ma}:${mi}` : null;
}

export interface Scene {
  dir: string;
  site: { id: string; name: string };
  scan: { id: string; capturedAt: string | null; originMarkerId: number | null };
  /** rect = [x, y, w, h] (m). 화면 표시용 사각형 — 잠정: 3D 연동 때 다각형으로 재결정 */
  zones: { id: string; name: string; color: string | null; sort: number; rect: [number, number, number, number] | null }[];
  /** beaconId = 이 단말(헬멧)이 내는 iBeacon "uuid:major:minor". 비콘을 안 쓰면 null */
  devices: { id: string; label: string; kind: DeviceKind; mac: string | null; beaconId: string | null }[];
  /**
   * 고정 수신기(게이트웨이). 헬멧 비콘을 듣고 1초마다 POST /api/gateway 로 보낸다. 구역마다 1대 이상.
   * 같은 구역에 2대 이상이면 레이더가 헬멧 위치(방향 + 거리)를 계산한다 — world 는 실제로 잰 자리 (m).
   * ref1mDbm = 이 수신기 폰에서 잰 1m 세기 (폰마다 다르다. null 이면 locate.ref1mDbm)
   */
  gateways: { id: string; zone: string; label: string; world: [number, number, number]; ref1mDbm: number | null }[];
  locate: LocateParams;
  /** 고정 비콘. 데모 범위 밖 (실시간 위치는 로드맵) */
  anchors: {
    id: string;
    zone: string | null;
    mac: string;
    marker: number | null;
    world: [number, number, number];
    source: 'marker' | 'manual';
  }[];
  robot: { id: string; home: Pose; battery: number };
  /** 사전 계산표. 계산 서비스가 응답하지 않으면 이것으로 출동한다 */
  routes: { starts: Record<string, Pose>; routes: Route[] } | null;
  /** 새 회차를 만들 때 넣을 데모 데이터 (demo/seed.json). 없으면 빈 회차 */
  seedPath: string | null;
  /** 시작할 때 보여줄 안내 */
  notes: string[];
}

type Json = Record<string, unknown>;

function fail(where: string, what: string): never {
  throw new Error(`${where}: ${what}`);
}

export function readJson(path: string): Json | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Json;
  } catch (e) {
    return fail(path, `JSON 으로 읽지 못했습니다 — ${(e as Error).message}`);
  }
}

const obj = (v: unknown, where: string): Json =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : fail(where, '객체여야 합니다');
const list = (v: unknown, where: string): unknown[] => (Array.isArray(v) ? v : fail(where, '배열이어야 합니다'));
const str = (v: unknown, where: string): string =>
  typeof v === 'string' && v.trim() ? v : fail(where, '빈 문자열이 아닌 문자열이어야 합니다');
const num = (v: unknown, where: string): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fail(where, '숫자여야 합니다');

function nums(v: unknown, n: number, where: string): number[] {
  const a = list(v, where);
  if (a.length < n) fail(where, `숫자 ${n}개가 필요합니다`);
  return a.slice(0, n).map((x, i) => num(x, `${where}[${i}]`));
}

/**
 * 씬 폴더의 demo/ 파일을 읽는다: demo.json(현장 · 단말 · 구역 · 로봇) · robot_home.json · routes.json · seed.json.
 * 틀린 곳이 있으면 시작하기 전에 멈춘다: 무대에서 반쯤 돌다 죽는 것보다 낫다.
 */
export function loadScene(dir: string): Scene {
  const demoDir = join(dir, 'demo');
  const demoPath = join(demoDir, 'demo.json');
  const demo = readJson(demoPath);
  if (!demo) {
    throw new Error(`${demoPath} 가 없습니다.\n  SCENE_DIR 이 씬 폴더를 가리키는지 확인하세요 (예시: backend/scenes/dev).`);
  }
  const notes: string[] = [];
  const at = (key: string) => `demo.json ${key}`;

  const sp = obj(demo.site ?? demo.space, at('site'));
  const site = { id: str(sp.id, at('site.id')), name: str(sp.name, at('site.name')) };

  const zones = list(demo.zones, at('zones')).map((v, i) => {
    const where = at(`zones[${i}]`);
    const z = obj(v, where);
    const rect = z.rect === undefined ? null : (nums(z.rect, 4, `${where}.rect`) as [number, number, number, number]);
    if (rect && (rect[2] <= 0 || rect[3] <= 0)) fail(`${where}.rect`, '너비 · 높이는 0 보다 커야 합니다');
    return {
      id: str(z.id, `${where}.id`),
      name: str(z.name, `${where}.name`),
      color: z.color == null ? null : str(z.color, `${where}.color`),
      sort: typeof z.sort === 'number' ? z.sort : i + 1,
      rect,
    };
  });
  if (!zones.length) fail(at('zones'), '구역이 하나 이상 있어야 합니다');
  const zoneIds = new Set(zones.map((z) => z.id));
  const zoneRef = (v: unknown, where: string): string | null => {
    if (v === undefined || v === null) return null;
    const id = str(v, where);
    return zoneIds.has(id) ? id : fail(where, `demo.json zones 에 없는 구역입니다: ${id}`);
  };

  const devices = list(demo.devices, at('devices')).map((v, i) => {
    const where = at(`devices[${i}]`);
    const d = obj(v, where);
    const kind = (d.kind ?? 'phone') as DeviceKind;
    if (!['phone', 'helmet_beacon', 'uwb_tag'].includes(kind)) {
      fail(`${where}.kind`, `phone · helmet_beacon · uwb_tag 중 하나여야 합니다: ${String(kind)}`);
    }
    const rawBeacon = d.beacon_id == null ? null : str(d.beacon_id, `${where}.beacon_id`);
    const beaconId =
      rawBeacon === null
        ? null
        : (normalizeBeaconId(rawBeacon) ??
          fail(`${where}.beacon_id`, `iBeacon "uuid:major:minor" 형식이어야 합니다 (major · minor 는 0~65535): ${rawBeacon}`));
    return {
      id: str(d.id, `${where}.id`),
      label: str(d.label, `${where}.label`),
      kind,
      mac: d.mac == null ? null : str(d.mac, `${where}.mac`),
      beaconId,
    };
  });
  if (!devices.length) fail(at('devices'), '단말이 하나 이상 있어야 합니다');
  const beaconIds = devices.map((d) => d.beaconId).filter((b): b is string => !!b);
  if (new Set(beaconIds).size !== beaconIds.length) fail(at('devices'), '두 단말이 같은 beacon_id 를 쓰고 있습니다');

  // 수신기: 구역마다 1대 이상. 위치를 안 주면 구역 사각형 가운데 · 바닥 위 1m
  const gateways = (demo.gateways === undefined ? [] : list(demo.gateways, at('gateways'))).map((v, i) => {
    const where = at(`gateways[${i}]`);
    const g = obj(v, where);
    const zone = zoneRef(g.zone, `${where}.zone`) ?? fail(`${where}.zone`, '수신기가 지키는 구역이 필요합니다');
    const rect = zones.find((z) => z.id === zone)!.rect;
    const world =
      g.world !== undefined
        ? (nums(g.world, 3, `${where}.world`) as [number, number, number])
        : ([rect ? rect[0] + rect[2] / 2 : 0, rect ? rect[1] + rect[3] / 2 : 0, 1.0] as [number, number, number]);
    const ref1mDbm = g.ref_1m_dbm == null ? null : num(g.ref_1m_dbm, `${where}.ref_1m_dbm`);
    if (ref1mDbm !== null && (ref1mDbm >= 0 || ref1mDbm < -120)) fail(`${where}.ref_1m_dbm`, `-120 ~ 0 (dBm) 이어야 합니다: ${ref1mDbm}`);
    return {
      id: str(g.id, `${where}.id`),
      zone,
      label: g.label == null ? str(g.id, `${where}.id`) : str(g.label, `${where}.label`),
      world,
      ref1mDbm,
    };
  });
  if (new Set(gateways.map((g) => g.id)).size !== gateways.length) fail(at('gateways'), '수신기 id 가 겹칩니다');

  const lc = demo.locate === undefined ? {} : obj(demo.locate, at('locate'));
  const pick = (key: string, fallback: number) => (lc[key] === undefined ? fallback : num(lc[key], at(`locate.${key}`)));
  const locate: LocateParams = {
    windowS: pick('window_s', DEFAULT_LOCATE.windowS),
    enterDbm: pick('enter_dbm', DEFAULT_LOCATE.enterDbm),
    exitMarginDb: pick('exit_margin_db', DEFAULT_LOCATE.exitMarginDb),
    switchDb: pick('switch_db', DEFAULT_LOCATE.switchDb),
    holdS: pick('hold_s', DEFAULT_LOCATE.holdS),
    timeoutS: pick('timeout_s', DEFAULT_LOCATE.timeoutS),
    pathLossN: pick('path_loss_n', DEFAULT_LOCATE.pathLossN),
    ref1mDbm: lc.ref_1m_dbm == null ? DEFAULT_LOCATE.ref1mDbm : num(lc.ref_1m_dbm, at('locate.ref_1m_dbm')),
  };
  if (locate.windowS <= 0 || locate.holdS < 0 || locate.timeoutS <= locate.windowS) {
    fail(at('locate'), 'window_s > 0, hold_s ≥ 0, timeout_s > window_s 여야 합니다');
  }
  if (locate.pathLossN < 1 || locate.pathLossN > 6) fail(at('locate.path_loss_n'), `1 ~ 6 이어야 합니다 (자유 공간 2, 실내 2.5~3.5): ${locate.pathLossN}`);
  if (locate.ref1mDbm !== null && (locate.ref1mDbm >= 0 || locate.ref1mDbm < -120)) {
    fail(at('locate.ref_1m_dbm'), `-120 ~ 0 (dBm) 이어야 합니다: ${locate.ref1mDbm}`);
  }

  // scan: 씬 폴더 1개 = 좌표계 1개. 파일이 없으면 폴더 이름을 id 로 쓴다
  const capture = readJson(join(dir, 'capture.json'));
  const cameras = readJson(join(dir, 'pose', 'cameras.json'));
  const origin = (cameras?.scale as Json | undefined)?.origin_marker_id;
  const scan = {
    id: typeof capture?.scene_id === 'string' && capture.scene_id ? capture.scene_id : basename(dir),
    capturedAt: typeof capture?.captured_at === 'string' ? capture.captured_at : null,
    originMarkerId: typeof origin === 'number' && Number.isInteger(origin) && origin >= 0 ? origin : null,
  };

  // 앵커 = demo.json 의 beacons(MAC) + zones.json 의 좌표. 데모 범위 밖이라 없어도 된다
  const zonesFile = readJson(join(demoDir, 'zones.json'));
  const floorZ = typeof zonesFile?.floor_z === 'number' ? zonesFile.floor_z : 0;
  const placed = new Map<string, Json>();
  const rawAnchors = zonesFile?.anchors;
  for (const [i, v] of (Array.isArray(rawAnchors) ? rawAnchors : []).entries()) {
    const a = obj(v, `zones.json anchors[${i}]`);
    if (typeof a.beacon === 'string') placed.set(a.beacon, a);
  }
  const height = typeof demo.beacon_height_m === 'number' ? demo.beacon_height_m : 1.0;
  const anchors: Scene['anchors'] = [];
  const beacons = demo.beacons === undefined ? [] : list(demo.beacons, at('beacons'));
  for (const [i, v] of beacons.entries()) {
    const where = at(`beacons[${i}]`);
    const b = obj(v, where);
    const id = str(b.id, `${where}.id`);
    if (b.mac == null) {
      notes.push(`비콘 ${id}: MAC 이 없어 앵커로 넣지 않았습니다`);
      continue;
    }
    const p = placed.get(id);
    let world: [number, number, number];
    let source: 'marker' | 'manual';
    if (p?.world !== undefined) {
      const [x, y, z] = nums(p.world, 3, `zones.json ${id}.world`);
      world = [x, y, z];
      source = p.marker == null ? 'manual' : 'marker';
    } else if (b.world !== undefined) {
      const [x, y] = nums(b.world, 2, `${where}.world`);
      world = [x, y, floorZ + height];
      source = 'manual';
    } else {
      notes.push(`비콘 ${id}: 위치가 없어 앵커로 넣지 않았습니다 (zones.json 또는 world 필요)`);
      continue;
    }
    const markerRaw = b.marker ?? p?.marker;
    const marker = markerRaw == null ? null : Number(markerRaw);
    if (marker !== null && !Number.isInteger(marker)) fail(`${where}.marker`, `마커 번호가 아닙니다: ${String(markerRaw)}`);
    anchors.push({ id, zone: zoneRef(b.zone ?? p?.zone, `${where}.zone`), mac: str(b.mac, `${where}.mac`), marker, world, source });
  }

  // 로봇 대기 위치: robot_home.json, 없으면 사전 계산표의 home
  const routesFile = readJson(join(demoDir, 'routes.json'));
  const homeFile = readJson(join(demoDir, 'robot_home.json'));
  let home: Pose;
  if (homeFile) {
    const [x, y] = nums(homeFile.world, 2, 'robot_home.json world');
    const yawDeg = homeFile.yaw_deg === undefined ? 0 : num(homeFile.yaw_deg, 'robot_home.json yaw_deg');
    home = { x, y, yaw: (yawDeg * Math.PI) / 180 };
  } else {
    const h = (routesFile?.starts as Json | undefined)?.home;
    if (h === undefined) throw new Error(`${join(demoDir, 'robot_home.json')} 가 없습니다 (로봇 대기 위치).`);
    const [x, y, yaw] = nums(h, 3, 'routes.json starts.home');
    home = { x, y, yaw };
    notes.push('robot_home.json 이 없어 routes.json 의 home 을 대기 위치로 썼습니다');
  }
  const rb = demo.robot === undefined ? {} : obj(demo.robot, at('robot'));
  const battery = rb.battery === undefined ? 100 : num(rb.battery, at('robot.battery'));
  if (battery < 0 || battery > 100) fail(at('robot.battery'), '0~100 이어야 합니다');
  const robot = { id: rb.id === undefined ? 'R-01' : str(rb.id, at('robot.id')), home, battery: Math.round(battery) };

  const routes = routesFile ? parseRoutes(routesFile, zoneIds) : null;
  if (!routes) notes.push('routes.json(사전 계산표)이 없습니다: 계산 서비스가 응답하지 않으면 로봇이 출동하지 못합니다');

  const seed = join(demoDir, 'seed.json');
  return { dir, site, scan, zones, devices, gateways, locate, anchors, robot, routes, seedPath: existsSync(seed) ? seed : null, notes };
}

function parseRoutes(file: Json, zoneIds: Set<string>): NonNullable<Scene['routes']> {
  const starts: Record<string, Pose> = {};
  for (const [k, v] of Object.entries(obj(file.starts, 'routes.json starts'))) {
    const [x, y, yaw] = nums(v, 3, `routes.json starts.${k}`);
    starts[k] = { x, y, yaw };
  }
  const routes = list(file.routes, 'routes.json routes').map((v, i): Route => {
    const w = `routes.json routes[${i}]`;
    const r = obj(v, w);
    const path = list(r.path, `${w}.path`).map((p, j) => nums(p, 2, `${w}.path[${j}]`) as Xy);
    const trajectory = list(r.trajectory, `${w}.trajectory`).map(
      (p, j) => nums(p, 4, `${w}.trajectory[${j}]`) as TrajPoint,
    );
    if (!path.length || !trajectory.length) fail(w, '경로나 궤적이 비어 있습니다');
    const to = str(r.to, `${w}.to`);
    if (!zoneIds.has(to)) fail(`${w}.to`, `demo.json zones 에 없는 구역입니다: ${to} (다른 씬의 routes.json 인가요?)`);
    return {
      from: str(r.from, `${w}.from`),
      to,
      path,
      goal: r.goal === undefined ? path[path.length - 1] : (nums(r.goal, 2, `${w}.goal`) as Xy),
      snapped: r.snapped === true,
      trajectory,
      reached: r.reached === true,
      duration_s: num(r.duration_s, `${w}.duration_s`),
      distance_m: num(r.distance_m, `${w}.distance_m`),
    };
  });
  return { starts, routes };
}
