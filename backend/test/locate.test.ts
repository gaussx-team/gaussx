import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadScene, type Scene } from '../src/config/scene.js';
import { LocateService } from '../src/locate/locate.service.js';
import { DEV_SCENE_DIR } from '../src/paths.js';
import { startServer, type TestServer } from './helpers.js';

// 헬멧 비콘 → 고정 수신기 → 구역 판정 · 레이더 (서버 메모리).
// 개발용 씬: 단말 2대 · 수신기 gw-01 (0, 1.5) · gw-02 (2, 1.5) = 1구역 아래쪽 양끝, 구역(가운데 1, 0.75)을 바라본다
// 판정 값: window 1.5초 · 들어옴 -70dBm · 나감 여유 6dB (-76 보다 약하면) · 바뀜 6dB · 유지 2초 · 끊김 4초
// 거리 어림: 1m = -59 dBm · 감쇠 지수 2.5 → 2m = -66.5, 10m = -84

const B1 = '9d299ff3-5431-40e6-85d6-4ac08806000e:1:1'; // device-01
const B2 = '9d299ff3-5431-40e6-85d6-4ac08806000e:1:2'; // device-02

const DEV = loadScene(DEV_SCENE_DIR);
/** 구역이 다른 수신기 두 대 (구역 바뀜 시험) */
const TWO_ZONES: Scene = {
  ...DEV,
  gateways: [DEV.gateways[0], { id: 'gw-z2', zone: 'Z2', label: '2구역 수신기', world: [3, 0.75, 1], ref1mDbm: null }],
};

/** 시계를 손으로 돌리는 판정기. 보고는 1초마다라고 보고 tick() 으로 1초씩 넘긴다 */
function rig(scene: Scene = DEV) {
  const loc = new LocateService(scene);
  let t = Date.parse('2026-11-05T05:00:00Z');
  loc.now = () => t;
  return {
    loc,
    tick: (ms = 1000) => {
      t += ms;
    },
    report: (gatewayId: string, rssi: Record<string, number[]> = {}, txPower?: number) =>
      loc.ingest(gatewayId, Object.entries(rssi).map(([beaconId, v]) => ({ beaconId, rssi: v, txPower }))),
    state: (deviceId = 'device-01') => loc.presence().find((p) => p.deviceId === deviceId)!,
  };
}

/** 바닥의 점 p 에 있는 비콘을 수신기 g 에서 들으면 (1m = ref, 감쇠 지수 2.5) */
function rssiAt(gatewayId: string, p: [number, number], ref = -59) {
  const g = DEV.gateways.find((x) => x.id === gatewayId)!;
  return ref - 25 * Math.log10(Math.hypot(p[0] - g.world[0], p[1] - g.world[1]));
}

describe('비콘 구역 판정 (수신기 RSSI → 안 · 밖 · 알 수 없음)', () => {
  it('처음엔 알 수 없음 · 수신기 꺼짐', () => {
    const r = rig();
    assert.deepEqual(r.loc.presence().map((p) => [p.deviceId, p.beaconId, p.state, p.zoneId]), [
      ['device-01', B1, 'unknown', null],
      ['device-02', B2, 'unknown', null],
    ]);
    assert.deepEqual(r.loc.gateways().map((g) => [g.id, g.zoneId, g.online, g.lastReportAt]), [
      ['gw-01', 'Z1', false, null],
      ['gw-02', 'Z1', false, null],
    ]);
    assert.equal(r.loc.zoneOf('device-01'), null);
  });

  it('들어옴: 기준(-70)보다 센 신호가 2초 이어져야 안', () => {
    const r = rig();
    let [p] = r.report('gw-01', { [B1]: [-60, -62, -61] });
    assert.deepEqual([p.state, p.zoneId, p.pending], ['out', null, { kind: 'enter', gatewayId: 'gw-01', forS: 0 }]);
    r.tick();
    [p] = r.report('gw-01', { [B1]: [-60, -62, -61] });
    assert.deepEqual([p.state, p.pending?.forS], ['out', 1]);
    r.tick();
    [p] = r.report('gw-01', { [B1]: [-60, -62, -61] });
    assert.deepEqual([p.state, p.zoneId, p.gatewayId, p.rssi, p.pending], ['in', 'Z1', 'gw-01', -61, null]);
    assert.deepEqual(r.loc.zoneOf('device-01'), { zoneId: 'Z1', gatewayId: 'gw-01', rssi: -61 });
    assert.equal(r.loc.zoneOf('device-02'), null);
    assert.equal(r.state('device-02').state, 'unknown'); // 들린 적 없는 단말은 그대로
    assert.equal(r.loc.gateways()[0].online, true);
  });

  it('1초짜리 센 신호로는 들어오지 않는다', () => {
    const r = rig();
    r.report('gw-01', { [B1]: [-55] });
    for (let i = 0; i < 5; i++) {
      r.tick();
      r.report('gw-01', { [B1]: [-82] });
    }
    assert.deepEqual([r.state().state, r.state().pending], ['out', null]);
  });

  it('문턱 근처(-72 ~ -75)에서는 깜빡이지 않고, -76 보다 약한 채로 2초면 나감', () => {
    const r = rig();
    for (let i = 0; i < 3; i++, r.tick()) r.report('gw-01', { [B1]: [-60] });
    assert.equal(r.state().state, 'in');
    for (let i = 0; i < 10; i++, r.tick()) r.report('gw-01', { [B1]: i % 2 ? [-72, -74] : [-75, -73] });
    assert.deepEqual([r.state().state, r.state().pending], ['in', null]);

    let [p] = r.report('gw-01', { [B1]: [-85, -85, -85] });
    assert.deepEqual([p.state, p.pending?.kind], ['in', 'exit']);
    r.tick();
    [p] = r.report('gw-01', { [B1]: [-85, -85, -85] });
    assert.equal(p.state, 'in');
    r.tick();
    [p] = r.report('gw-01', { [B1]: [-85, -85, -85] });
    assert.deepEqual([p.state, p.zoneId, p.gatewayId, p.rssi], ['out', null, null, -85]);
    assert.equal(r.loc.zoneOf('device-01'), null);
  });

  it('끊김: 4초 넘게 안 들리면 알 수 없음 → 다시 들리면 밖에서부터 다시 판정', () => {
    const r = rig();
    for (let i = 0; i < 3; i++, r.tick()) r.report('gw-01', { [B1]: [-60] });
    const seen = r.state().lastSeen;
    for (let i = 0; i < 5; i++, r.tick()) r.report('gw-01'); // 수신기는 살아 있고 비콘만 안 들린다
    assert.deepEqual([r.state().state, r.state().zoneId, r.state().lastSeen], ['unknown', null, seen]);
    assert.equal(r.loc.gateways()[0].online, true);

    let [p] = r.report('gw-01', { [B1]: [-60] });
    assert.deepEqual([p.state, p.pending?.kind], ['out', 'enter']);
    r.tick();
    r.report('gw-01', { [B1]: [-60] });
    r.tick();
    [p] = r.report('gw-01', { [B1]: [-60] });
    assert.equal(p.state, 'in');

    r.tick(6000); // 수신기도 조용하다 (폴링만)
    assert.equal(r.state().state, 'unknown');
    assert.equal(r.loc.gateways()[0].online, false);
  });

  it('구역이 다른 수신기 두 대: 다른 쪽이 6dB 이상 센 채로 2초면 구역이 바뀌고, 조금 센 건 안 바뀐다', () => {
    const r = rig(TWO_ZONES);
    const step = (g1: number, g2: number) => {
      r.tick();
      r.report('gw-01', { [B1]: [g1] });
      r.report('gw-z2', { [B1]: [g2] });
      return r.state();
    };
    for (let i = 0; i < 3; i++) step(-60, -80);
    assert.deepEqual([r.state().state, r.state().zoneId], ['in', 'Z1']);
    for (let i = 0; i < 5; i++) step(-66, -62); // 4dB 차이 → 그대로
    assert.deepEqual([r.state().zoneId, r.state().pending], ['Z1', null]);

    let p = step(-72, -58);
    assert.deepEqual([p.zoneId, p.pending?.kind, p.pending?.gatewayId], ['Z1', 'switch', 'gw-z2']);
    p = step(-72, -58);
    assert.equal(p.zoneId, 'Z1');
    p = step(-72, -58);
    assert.deepEqual([p.state, p.zoneId, p.gatewayId, p.rssi], ['in', 'Z2', 'gw-z2', -58]);
  });

  it('같은 구역의 수신기끼리 바뀌어도 구역 · 들어온 시각은 그대로', () => {
    const r = rig();
    const step = (g1: number, g2: number) => {
      r.tick();
      r.report('gw-01', { [B1]: [g1] });
      r.report('gw-02', { [B1]: [g2] });
      return r.state();
    };
    for (let i = 0; i < 3; i++) step(-60, -80);
    const since = r.state().since;
    for (let i = 0; i < 4; i++) step(-75, -60);
    assert.deepEqual([r.state().state, r.state().zoneId, r.state().gatewayId, r.state().since], ['in', 'Z1', 'gw-02', since]);
  });

  it('등록 안 된 비콘은 판정에 안 쓰고 보정 화면에만 · 이상한 RSSI 는 버린다 · 모르는 수신기는 거부', () => {
    const r = rig();
    const touched = r.report('gw-01', { 'AAAAAAAA-0000-0000-0000-000000000000:9:9': [-50], [B1.toUpperCase().replace(':1:1', ':001:01')]: [-60] });
    assert.deepEqual(touched.map((p) => p.deviceId), ['device-01']); // 대문자 · 앞자리 0 이 달라도 같은 비콘
    assert.deepEqual(r.loc.debug().unknownBeacons.map((u) => [u.beaconId, u.gatewayId, u.rssi]), [
      ['aaaaaaaa-0000-0000-0000-000000000000:9:9', 'gw-01', -50],
    ]);
    assert.deepEqual(r.report('gw-01', { [B2]: [0, 5, -200, Number.NaN] }), []);
    assert.equal(r.state('device-02').state, 'unknown');
    assert.throws(() => r.loc.ingest('gw-99', []), /등록되지 않은 수신기예요: gw-99/);

    r.tick(31_000); // 30초 지나면 보정 화면에서도 사라진다
    r.report('gw-01');
    assert.deepEqual(r.loc.debug().unknownBeacons, []);
  });
});

describe('레이더 (수신기 두 대 → 헬멧 방향 · 거리)', () => {
  /** 비콘이 바닥의 점 p 에 있을 때 두 수신기가 1초마다 보고 (n 초). 보고 응답처럼 레이더도 매초 계산한다 */
  const at = (r: ReturnType<typeof rig>, p: [number, number], seconds = 1) => {
    for (let i = 0; i < seconds; i++) {
      r.report('gw-01', { [B1]: [rssiAt('gw-01', p)] });
      r.report('gw-02', { [B1]: [rssiAt('gw-02', p)] });
      r.loc.radar('gw-01');
      r.tick();
    }
  };

  it('두 대가 들으면 위치: 수신기마다 자기 기준(x 오른쪽 · y 앞)으로, 다른 수신기 · 구역도 함께', () => {
    const r = rig();
    at(r, [1.5, 0.5]);
    const a = r.loc.radar('gw-01');
    assert.deepEqual(a.receivers, [{ id: 'gw-02', label: '수신기 2', x: 2, y: 0, online: true }]); // 오른쪽 2m
    // 관제 화면용: 바닥 좌표 그대로 (구역 · 태그 · 로봇과 같은 m)
    const [p] = r.loc.presence();
    assert.deepEqual([p.position?.x, p.position?.y, p.state, p.zoneId], [1.5, 0.5, 'out', null]); // 구역 판정은 2초 유지 뒤
    assert.deepEqual(r.loc.gateways().map((g) => [g.id, g.x, g.y]), [['gw-01', 0, 1.5], ['gw-02', 2, 1.5]]);
    assert.deepEqual(a.zone, { id: 'Z1', name: '1구역 · 배관', polygon: [[0, 1.5], [2, 1.5], [2, 0], [0, 0]] }); // 앞쪽 2 × 1.5m
    assert.deepEqual(a.blips.map((b) => [b.deviceId, b.x, b.y, b.distance, b.heardBy]), [['device-01', 1.5, 1, 1.8, ['gw-02', 'gw-01']]]);
    assert.ok(a.blips[0].err! > 0.5 && a.blips[0].err! < 1.5);

    const b = r.loc.radar('gw-02');
    assert.deepEqual(b.receivers.map((x) => [x.id, x.x, x.y]), [['gw-01', -2, 0]]); // 왼쪽 2m
    assert.deepEqual(b.blips.map((x) => [x.x, x.y, x.distance]), [[-0.5, 1, 1.12]]); // 왼쪽 앞
    assert.deepEqual(r.loc.debug().devices[0].position, { x: 1.5, y: 0.5, err: a.blips[0].err, gateways: ['gw-02', 'gw-01'] });
  });

  it('한 대만 들으면 거리만 (방향 모름) · 못 들은 수신기에는 거리도 없다', () => {
    const r = rig();
    r.report('gw-01', { [B1]: [rssiAt('gw-01', [0, -0.5])] }); // 2m
    const a = r.loc.radar('gw-01').blips[0];
    assert.deepEqual([a.x, a.y, a.err, a.distance, a.heardBy], [null, null, null, 2, ['gw-01']]);
    assert.equal(r.loc.presence()[0].position, null); // 관제 화면에도 위치 없음 (구역 판정만)
    const b = r.loc.radar('gw-02').blips[0];
    assert.deepEqual([b.distance, b.rssi, b.heardBy], [null, null, ['gw-01']]);
    assert.deepEqual(r.loc.radar('gw-01').blips.map((x) => x.deviceId), ['device-01']); // 안 들린 단말은 레이더에 없다
  });

  it('움직이면 1~2초에 걸쳐 따라간다 (튀지 않게)', () => {
    const r = rig();
    at(r, [1.5, 0.5], 4);
    at(r, [0.5, 0.5], 1);
    const mid = r.loc.radar('gw-01').blips[0];
    assert.ok(mid.x! > 0.5 && mid.x! < 1.5, `중간이어야 해요: ${mid.x}`);
    at(r, [0.5, 0.5], 10);
    const end = r.loc.radar('gw-01').blips[0];
    assert.ok(Math.abs(end.x! - 0.5) < 0.05 && Math.abs(end.y! - 1) < 0.05, `${end.x}, ${end.y}`);
  });

  it('잡음으로 두 거리 원이 안 만나면 기준선 위 가장 가까운 점', () => {
    const r = rig();
    r.report('gw-01', { [B1]: [-59 + 25 * Math.log10(2)] }); // 0.5m
    r.report('gw-02', { [B1]: [-59 + 25 * Math.log10(2)] }); // 0.5m (둘 사이 2m 인데)
    assert.deepEqual(r.loc.radar('gw-01').blips.map((b) => [b.x, b.y]), [[1, 0]]);
  });

  it('1m 세기: 수신기 값(관리자 화면 · 1m 보정 > 씬) > 비콘이 알린 값 > -59 · 1m 보정 측정은 재기만 한다', () => {
    const r = rig();
    r.report('gw-01', { [B1]: [-65] }, -65); // 비콘이 '1m = -65' 라고 알린다
    assert.equal(r.loc.radar('gw-01').blips[0].distance, 1);
    assert.throws(() => r.loc.measureRef1m('gw-02'), /수신기 2에 최근 3초 동안 들린 비콘이 없어요/);
    for (let i = 0; i < 5; i++) r.report('gw-01', { [B1]: [-50] });
    assert.deepEqual(r.loc.measureRef1m('gw-01'), { gatewayId: 'gw-01', ref1mDbm: -50, deviceId: 'device-01', label: '단말 1번', samples: 6 });
    assert.deepEqual(r.loc.gateways().map((g) => [g.id, g.ref1mDbm]), [['gw-01', null], ['gw-02', null]]); // 저장은 GatewaySettings

    const scene: Scene = { ...DEV, gateways: DEV.gateways.map((g) => (g.id === 'gw-01' ? { ...g, ref1mDbm: -70 } : g)) };
    const s = rig(scene);
    s.report('gw-01', { [B1]: [-70] }, -59);
    assert.equal(s.loc.radar('gw-01').blips[0].distance, 1); // 수신기 값이 비콘이 알린 값보다 먼저
    assert.equal(s.loc.gateways()[0].ref1mDbm, -70);
    assert.throws(() => s.loc.radar('gw-99'), /등록되지 않은 수신기예요: gw-99/);
  });
});

describe('비콘 API · 쓰러짐 구역 (직접 지정 > 비콘 > 작업 중 구역)', () => {
  let s: TestServer;
  let t = Date.now();
  const report = (beaconId: string, rssi: number) =>
    s.ok('POST', '/api/gateway', { gatewayId: 'gw-01', readings: [{ beaconId, rssi: [rssi, rssi - 1, rssi + 1], txPower: -59 }] });
  /** 1초 간격 보고 3번 → 안 (판정 시계만 넘긴다) */
  const enter = async (beaconId: string) => {
    let last;
    for (let i = 0; i < 3; i++) {
      last = await report(beaconId, -60);
      t += 1000;
    }
    return last;
  };

  before(async () => {
    s = await startServer();
    s.get(LocateService).now = () => t;
  });
  after(() => s.close());

  it('수신기 보고: 모르는 수신기 · 형식 오류는 400', async () => {
    const bad = await s.fail('POST', '/api/gateway', { gatewayId: 'gw-99', readings: [] }, 400);
    assert.match(bad.message, /등록되지 않은 수신기예요: gw-99/);
    await s.fail('POST', '/api/gateway', { gatewayId: 'gw-01', readings: [{ beaconId: B1, rssi: 'x' }] }, 400);
    await s.fail('POST', '/api/gateway', { gatewayId: 'gw-01' }, 400);
    const alive = await s.ok('POST', '/api/gateway', { gatewayId: 'gw-01', readings: [] }); // 빈 보고 = 살아 있음
    assert.deepEqual([alive.ok, alive.gatewayId, alive.zoneId, alive.devices, alive.radar.blips], [true, 'gw-01', 'Z1', [], []]);
    assert.deepEqual(alive.radar.receivers, [{ id: 'gw-02', label: '수신기 2', x: 2, y: 0, online: false }]);
  });

  it('들어오면 상태 · 보정 화면 · 설정에 보인다', async () => {
    const first = await report(B1, -60);
    assert.deepEqual(first.devices.map((d: any) => [d.deviceId, d.state, d.pending?.kind]), [['device-01', 'out', 'enter']]);
    t += 1000;
    const last = await enter(B1);
    assert.deepEqual([last.devices[0].state, last.devices[0].zoneId], ['in', 'Z1']);

    const st = await s.ok('GET', '/api/state');
    assert.deepEqual(st.presence.map((p: any) => [p.deviceId, p.state, p.zoneId]), [
      ['device-01', 'in', 'Z1'],
      ['device-02', 'unknown', null],
    ]);
    assert.deepEqual(st.gateways.map((g: any) => [g.id, g.zoneId, g.online]), [
      ['gw-01', 'Z1', true],
      ['gw-02', 'Z1', false],
    ]);
    const dbg = await s.ok('GET', '/api/locate');
    assert.deepEqual(dbg.devices[0].links.map((l: any) => [l.gatewayId, l.median]), [['gw-01', -60]]);
    assert.equal(dbg.params.holdS, 2);
    const cfg = await s.ok('GET', '/api/config');
    assert.deepEqual(cfg.gateways, [
      { id: 'gw-01', zone: 'Z1', label: '수신기 1', world: [0, 1.5, 1], ref1mDbm: null },
      { id: 'gw-02', zone: 'Z1', label: '수신기 2', world: [2, 1.5, 1], ref1mDbm: null },
    ]);
    assert.deepEqual(cfg.devices.map((d: any) => d.beaconId), [B1, B2]);
  });

  it('쓰러짐: 비콘이 안이면 그 구역 (구역 출처 = 비콘) · 직접 지정이 가장 앞', async () => {
    await report(B1, -60); // 아직 안
    const a = await s.ok('POST', '/api/event', { source: 'sos_button', deviceId: 'device-01' });
    assert.deepEqual([a.zoneId, a.zoneSource, a.workId, a.status], ['Z1', 'beacon', 9, 'dispatched']); // 작업(W-009)은 그대로 묶인다
    await s.ok('POST', '/api/alert/resolve', { alertId: a.id, resolution: 'false_alarm' });

    const b = await s.ok('POST', '/api/event', { source: 'operator', deviceId: 'device-01', zoneId: 'Z3' });
    assert.deepEqual([b.zoneId, b.zoneSource], ['Z3', 'request']);
    await s.ok('POST', '/api/alert/resolve', { alertId: b.id, resolution: 'false_alarm' });

    const st = await s.ok('GET', '/api/state');
    assert.equal(st.alerts.find((x: any) => x.id === a.id).zoneSource, 'beacon');
    const raised = (await s.ok('GET', '/api/history?day=today')).events.find(
      (e: any) => e.type === 'alert.raised' && e.alertId === a.id,
    );
    assert.equal(raised.text, '쓰러짐 · Z1 (비콘) · sos_button');
    const [{ payload }] = await s.db.query<{ payload: any }>("SELECT payload FROM event WHERE type = 'alert.raised' AND alert_id = $1", [a.id]);
    assert.deepEqual([payload.zone, payload.zoneSource, payload.beacon.gatewayId], ['Z1', 'beacon', 'gw-01']);
  });

  it('쓰러짐: 비콘이 안이 아니면 작업 중 구역 → 비콘이 들어오면 비콘 (실제로 있는 곳)', async () => {
    // device-02 는 2구역 작업 중 (데모 W-007)
    const c = await s.ok('POST', '/api/event', { source: 'accel', deviceId: 'device-02' });
    assert.deepEqual([c.zoneId, c.zoneSource, c.workId], ['Z2', 'work', 7]);
    await s.ok('POST', '/api/alert/resolve', { alertId: c.id, resolution: 'false_alarm' });

    await enter(B2);
    const d = await s.ok('POST', '/api/event', { source: 'accel', deviceId: 'device-02' });
    assert.deepEqual([d.zoneId, d.zoneSource, d.workId], ['Z1', 'beacon', 7]);
    await s.ok('POST', '/api/alert/resolve', { alertId: d.id, resolution: 'false_alarm' });

    const e = await s.ok('POST', '/api/event', { source: 'operator' }); // 단말도 구역도 없다
    assert.deepEqual([e.zoneId, e.zoneSource], [null, null]);
  });
});

describe('레이더 API (수신기 두 대)', () => {
  let s: TestServer;
  let t = Date.now();
  const send = (gatewayId: string, p: [number, number]) =>
    s.ok('POST', '/api/gateway', { gatewayId, readings: [{ beaconId: B1, rssi: [rssiAt(gatewayId, p)], txPower: -59 }] });

  before(async () => {
    s = await startServer();
    s.get(LocateService).now = () => t;
  });
  after(() => s.close());

  it('보고 응답에 그 수신기의 레이더 · GET /api/radar · 1m 보정', async () => {
    await send('gw-01', [1.5, 0.5]);
    const reply = await send('gw-02', [1.5, 0.5]);
    assert.deepEqual(reply.radar.receivers.map((x: any) => [x.id, x.x, x.y, x.online]), [['gw-01', -2, 0, true]]);
    assert.deepEqual(reply.radar.blips.map((b: any) => [b.label, b.x, b.y, b.distance]), [['단말 1번', -0.5, 1, 1.12]]);

    const st0 = await s.ok('GET', '/api/state'); // 관제 화면이 받는 바닥 위치
    assert.deepEqual([st0.presence[0].position.x, st0.presence[0].position.y, st0.presence[1].position], [1.5, 0.5, null]);
    assert.deepEqual(st0.gateways.map((g: any) => [g.id, g.x, g.y]), [['gw-01', 0, 1.5], ['gw-02', 2, 1.5]]);
    const r1 = await s.ok('GET', '/api/radar?gateway=gw-01');
    assert.deepEqual(r1.blips.map((b: any) => [b.x, b.y, b.heardBy.length]), [[1.5, 1, 2]]);
    const bad = await s.fail('GET', '/api/radar?gateway=gw-99', undefined, 400);
    assert.match(bad.message, /등록되지 않은 수신기예요/);
    await s.fail('GET', '/api/radar', undefined, 400);

    const none = await s.fail('POST', '/api/gateway/calibrate', { gatewayId: 'gw-01' }, 400);
    assert.match(none.message, /최근 3초 동안 들린 비콘이 없어요/); // 표본 1개뿐
    t += 500;
    await s.ok('POST', '/api/gateway', { gatewayId: 'gw-01', readings: [{ beaconId: B1, rssi: [-55, -55, -56, -54, -55] }] });
    const c = await s.ok('POST', '/api/gateway/calibrate', { gatewayId: 'gw-01' });
    assert.deepEqual([c.gatewayId, c.label, c.saved], ['gw-01', '단말 1번', true]);
    const list = await s.ok('GET', '/api/gateways'); // 1m 보정은 저장된다 (관리자 화면에서도 보인다)
    assert.deepEqual(list.map((g: any) => [g.id, g.ref1mDbm === c.ref1mDbm, g.custom]), [['gw-01', true, true], ['gw-02', false, false]]);
    const off = await s.ok('POST', '/api/gateway/calibrate', { gatewayId: 'gw-01', reset: true });
    assert.deepEqual([off.reset, off.ref1mDbm], [true, null]);
  });
});

describe('수신기 설정 (관리자 화면 · 수신기 배치)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gx-gw-'));
  const file = join(dir, 'gateways.json');
  let s: TestServer;

  before(async () => {
    s = await startServer({ GATEWAYS_FILE: file });
  });
  after(async () => {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('목록 = 씬 값 · 바꾸면 레이더 · 설정 · 이번 회차 앵커 · 파일에 바로', async () => {
    const list = await s.ok('GET', '/api/gateways');
    assert.deepEqual(list.map((g: any) => [g.id, g.zoneId, g.x, g.y, g.ref1mDbm, g.custom, g.online]), [
      ['gw-01', 'Z1', 0, 1.5, null, false, false],
      ['gw-02', 'Z1', 2, 1.5, null, false, false],
    ]);
    const moved = await s.ok('POST', '/api/gateway/settings', { gatewayId: 'gw-02', x: 3.456, y: 1.5, ref1mDbm: -61.24 });
    assert.deepEqual([moved.x, moved.y, moved.ref1mDbm, moved.custom, moved.defaults.x], [3.46, 1.5, -61.2, true, 2]);
    const radar = await s.ok('GET', '/api/radar?gateway=gw-01');
    assert.deepEqual(radar.receivers.map((r: any) => [r.id, r.x, r.y]), [['gw-02', 3.46, 0]]);
    const cfg = await s.ok('GET', '/api/config');
    assert.deepEqual(cfg.gateways.find((g: any) => g.id === 'gw-02').world, [3.46, 1.5, 1]);
    const [anchor] = await s.db.query("SELECT x, y FROM anchor WHERE id = 'gw-02'");
    assert.deepEqual(anchor, { x: 3.46, y: 1.5 });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).scenes.dev['gw-02'], { world: [3.46, 1.5, 1], ref1mDbm: -61.2 });
  });

  it('잘못된 값은 400 (모르는 수신기 · 구역 · 자리 · 1m 세기 · 형식)', async () => {
    const cases: [unknown, RegExp][] = [
      [{ gatewayId: 'gw-99', x: 1 }, /등록되지 않은 수신기예요/],
      [{ gatewayId: 'gw-01', zoneId: 'Z9' }, /없는 구역이에요: Z9/],
      [{ gatewayId: 'gw-01', x: 500 }, /-200 ~ 200 m/],
      [{ gatewayId: 'gw-01', ref1mDbm: 5 }, /-120 ~ 0 dBm/],
      [{ gatewayId: 'gw-01', x: 'a' }, /x/],
    ];
    for (const [body, want] of cases) {
      const e = await s.fail('POST', '/api/gateway/settings', body, 400);
      assert.match(String(e.message), want);
    }
  });

  it('데모 리셋 · 다시 켜도 남고, 되돌리면 씬 값', async () => {
    await s.ok('POST', '/api/gateway/settings', { gatewayId: 'gw-01', zoneId: 'Z3' });
    await s.ok('POST', '/api/debug/reset'); // 새 회차: 설정 반영이 바꾼 값으로 앵커를 쓴다
    const anchors = await s.db.query("SELECT id, zone_id, x FROM anchor WHERE kind = 'gateway' ORDER BY id");
    assert.deepEqual(anchors, [
      { id: 'gw-01', zone_id: 'Z3', x: 0 },
      { id: 'gw-02', zone_id: 'Z1', x: 3.46 },
    ]);

    const again = await startServer({ GATEWAYS_FILE: file }); // 서버를 다시 켠다
    try {
      const list = await again.ok('GET', '/api/gateways');
      assert.deepEqual(list.map((g: any) => [g.id, g.zoneId, g.x, g.custom]), [
        ['gw-01', 'Z3', 0, true],
        ['gw-02', 'Z1', 3.46, true],
      ]);
      const back = await again.ok('POST', '/api/gateway/settings', { gatewayId: 'gw-02', reset: true });
      assert.deepEqual([back.x, back.ref1mDbm, back.custom], [2, null, false]);
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).scenes.dev), ['gw-01']);
    } finally {
      await again.close();
    }
  });
});
