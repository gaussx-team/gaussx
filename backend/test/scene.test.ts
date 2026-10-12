import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { loadScene } from '../src/config/scene.js';
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
    assert.throws(() => loadSettings({ PORT: 'abc' }), /PORT/);
  });
});
