import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DEFAULT_LOCATE, loadScene } from '../src/config/scene.js';
import { loadSettings } from '../src/config/settings.js';
import { DEV_SCENE_DIR, SERVER_ROOT } from '../src/paths.js';
import { seedTime } from '../src/seed/seeder.js';

const made: string[] = [];
/** 개발용 씬을 복사하고 demo/ 파일 하나를 고친다 */
function sceneWith(file: string, edit: (json: any) => unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'gx-scene-'));
  made.push(dir);
  cpSync(DEV_SCENE_DIR, dir, { recursive: true });
  const path = join(dir, 'demo', file);
  writeFileSync(path, JSON.stringify(edit(JSON.parse(readFileSync(path, 'utf8')))));
  return dir;
}

describe('씬 파일 · 설정', () => {
  after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('개발용 씬 = 프론트 목업의 바닥 (4×3m · 구역 사각형 · 로봇 대기 3.3, 2.4 · 단말 2대)', () => {
    const s = loadScene(DEV_SCENE_DIR);
    assert.deepEqual(s.site, { id: 'demo', name: '데모 현장' });
    assert.deepEqual(s.zones.map((z) => [z.id, z.rect]), [['Z1', [0, 0, 2, 1.5]], ['Z2', [2, 0, 2, 1.5]], ['Z3', [0, 1.5, 2, 1.5]]]);
    assert.deepEqual(s.devices.map((d) => d.id), ['device-01', 'device-02']);
    assert.deepEqual(s.devices.map((d) => d.beaconId), [
      '9d299ff3-5431-40e6-85d6-4ac08806000e:1:1',
      '9d299ff3-5431-40e6-85d6-4ac08806000e:1:2',
    ]);
    // 수신기 두 대 = 1구역 아래쪽 양끝 (2m 간격, 구역을 바라본다)
    assert.deepEqual(s.gateways, [
      { id: 'gw-01', zone: 'Z1', label: '수신기 1', world: [0, 1.5, 1], ref1mDbm: null },
      { id: 'gw-02', zone: 'Z1', label: '수신기 2', world: [2, 1.5, 1], ref1mDbm: null },
    ]);
    assert.deepEqual(s.locate, {
      windowS: 1.5, enterDbm: -70, exitMarginDb: 6, switchDb: 6, holdS: 2, timeoutS: 4, pathLossN: 2.5, ref1mDbm: null,
    });
    assert.deepEqual([s.robot.id, s.robot.home.x, s.robot.home.y, s.robot.battery], ['R-01', 3.3, 2.4, 82]);
    assert.equal(s.routes?.routes.length, 9);
    assert.ok(s.seedPath?.endsWith('seed.json'));
    assert.deepEqual(s.notes, []);
  });

  it('demo.json 이 없으면 무엇을 확인할지 알려 주며 멈춘다', () => {
    assert.throws(() => loadScene(join(tmpdir(), 'gx-no-such-scene')), /demo\.json 가 없습니다[\s\S]*SCENE_DIR/);
  });

  it('잘못된 값은 시작 전에 멈춘다: 사전 계산표의 목적지 · 구역 사각형', () => {
    const a = sceneWith('routes.json', (r) => ({ ...r, routes: [{ ...r.routes[0], to: 'Z9' }] }));
    assert.throws(() => loadScene(a), /다른 씬의 routes\.json 인가요/);
    const b = sceneWith('demo.json', (d) => ({ ...d, zones: [{ id: 'Z1', name: 'a', rect: [0, 0, 0, 1] }] }));
    assert.throws(() => loadScene(b), /너비 · 높이는 0 보다 커야/);
  });

  it('비콘: 수신기 · 판정 값이 없으면 기본값, 비콘 id 는 소문자 · 앞자리 0 없이', () => {
    const dir = sceneWith('demo.json', ({ gateways, locate, ...d }) => ({
      ...d,
      devices: [{ id: 'device-01', label: 'a', beacon_id: '9D299FF3-5431-40E6-85D6-4AC08806000E:01:001' }, { id: 'device-02', label: 'b' }],
    }));
    const s = loadScene(dir);
    assert.deepEqual(s.devices.map((d) => d.beaconId), ['9d299ff3-5431-40e6-85d6-4ac08806000e:1:1', null]);
    assert.deepEqual(s.gateways, []);
    assert.deepEqual(s.locate, DEFAULT_LOCATE);
    // 수신기 위치를 안 주면 구역 가운데 · 바닥 위 1m
    const one = loadScene(sceneWith('demo.json', (d) => ({ ...d, gateways: [{ id: 'gw-01', zone: 'Z1', ref_1m_dbm: -62 }] })));
    assert.deepEqual(one.gateways, [{ id: 'gw-01', zone: 'Z1', label: 'gw-01', world: [1, 0.75, 1], ref1mDbm: -62 }]);
  });

  it('비콘: 잘못된 값은 시작 전에 멈춘다 (비콘 id 형식 · 겹침 · 수신기 구역 · 판정 값)', () => {
    const B = '9d299ff3-5431-40e6-85d6-4ac08806000e:1:1';
    const cases: [(d: any) => unknown, RegExp][] = [
      [(d) => ({ ...d, devices: [{ id: 'device-01', label: 'a', beacon_id: 'AA:BB:CC:DD:EE:FF' }] }), /uuid:major:minor/],
      [(d) => ({ ...d, devices: [{ id: 'device-01', label: 'a', beacon_id: B.replace(':1:1', ':70000:1') }] }), /0~65535/],
      [(d) => ({ ...d, devices: [{ id: 'device-01', label: 'a', beacon_id: B }, { id: 'device-02', label: 'b', beacon_id: B.replace(':1:1', ':01:1') }] }), /같은 beacon_id/],
      [(d) => ({ ...d, devices: [{ id: 'device-01', label: 'a', beacon_id: B }, { id: 'device-02', label: 'b', beacon_id: B }] }), /같은 beacon_id/],
      [(d) => ({ ...d, gateways: [{ id: 'gw-01' }] }), /구역이 필요합니다/],
      [(d) => ({ ...d, gateways: [{ id: 'gw-01', zone: 'Z9' }] }), /zones 에 없는 구역입니다: Z9/],
      [(d) => ({ ...d, gateways: [{ id: 'gw-01', zone: 'Z1' }, { id: 'gw-01', zone: 'Z2' }] }), /수신기 id 가 겹칩니다/],
      [(d) => ({ ...d, locate: { window_s: 4, timeout_s: 3 } }), /timeout_s > window_s/],
      [(d) => ({ ...d, locate: { path_loss_n: 0.5 } }), /path_loss_n[\s\S]*1 ~ 6/],
      [(d) => ({ ...d, locate: { ref_1m_dbm: 3 } }), /ref_1m_dbm[\s\S]*-120 ~ 0/],
      [(d) => ({ ...d, gateways: [{ id: 'gw-01', zone: 'Z1', ref_1m_dbm: -200 }] }), /ref_1m_dbm[\s\S]*-120 ~ 0/],
    ];
    for (const [edit, want] of cases) assert.throws(() => loadScene(sceneWith('demo.json', edit)), want);
  });

  it('사전 계산표 · 데모 데이터는 없어도 된다 (안내만)', () => {
    const dir = sceneWith('demo.json', (d) => d);
    unlinkSync(join(dir, 'demo', 'routes.json'));
    unlinkSync(join(dir, 'demo', 'seed.json'));
    const s = loadScene(dir);
    assert.equal(s.routes, null);
    assert.equal(s.seedPath, null);
    assert.equal(s.notes.length, 1);
  });

  it('데모 데이터 시각 표현 (KST)', () => {
    const now = new Date('2026-11-05T05:21:30Z'); // KST 14:21:30
    assert.equal(seedTime('D-6 09:30', now).toISOString(), '2026-10-30T00:30:00.000Z');
    assert.equal(seedTime('D-1 14:10:08', now).toISOString(), '2026-11-04T05:10:08.000Z');
    assert.equal(seedTime('-50m', now).toISOString(), '2026-11-05T04:31:30.000Z');
    assert.equal(seedTime('H+8', now).toISOString(), '2026-11-05T13:00:00.000Z');
    assert.throws(() => seedTime('어제', now), /시각 표현을 모릅니다/);
  });

  it('설정: 상대 경로는 backend/ 기준 · 기본 포트 3001 (루트 .env.example 의 프론트 주소와 같다)', () => {
    const s = loadSettings({ SCENE_DIR: 'scenes/dev', COMPUTE_URL: 'off' });
    assert.equal(s.sceneDir, join(SERVER_ROOT, 'scenes', 'dev'));
    assert.equal(s.port, 3001);
    assert.equal(s.computeUrl, null);
    assert.equal(s.gatewaysFile, join(SERVER_ROOT, '.data', 'gateways.json')); // 관리자 화면에서 바꾼 수신기 설정
    assert.throws(() => loadSettings({ PORT: 'abc' }), /PORT/);
  });
});
