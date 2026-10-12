import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { devRoute, fakeCompute, HANG, startDemoWork, startServer, type TestServer, waitFor } from './helpers.js';

// 쓰러짐 → 로봇 자동 출동 (관제 확인을 기다리지 않는다) → 도착 → 관제 확인 → 종료. 로봇이 못 가면 사람 출동

const arrived = (s: TestServer) => async () => {
  const st = await s.ok('GET', '/api/state');
  return st.robot.state === 'arrived' ? st : null;
};
const moving = (s: TestServer) => async () => {
  const st = await s.ok('GET', '/api/state');
  return st.robot.state === 'moving' ? st : null;
};
const todayTypes = async (s: TestServer) =>
  ((await s.ok('GET', '/api/history?day=today')).events as { type: string }[]).map((e) => e.type).reverse();

describe('C 쓰러짐 → 로봇 출동 (계산 서비스 꺼짐 → 사전 계산표)', () => {
  let s: TestServer;
  before(async () => {
    s = await startServer({ DISPATCH_SPEED: '20' });
    await startDemoWork(s); // device-01 이 1구역에서 작업 중
  });
  after(() => s.close());

  it('자동 감지 → 구역 = 그 단말의 작업 중 구역 → 바로 출동 → 도착', async () => {
    const a = await s.ok('POST', '/api/event', { source: 'accel', deviceId: 'device-01' });
    assert.deepEqual([a.type, a.source, a.zoneId, a.workId, a.status, a.deviceId], ['fall', 'accel', 'Z1', 9, 'dispatched', 'device-01']);

    const st = await waitFor(arrived(s), 5000, '도착');
    const route = devRoute('home', 'Z1');
    assert.deepEqual([st.robot.x, st.robot.y], route.trajectory.at(-1)!.slice(1, 3));
    assert.equal(st.robot.available, true); // 멈춰 있으면 다음 알림에 갈 수 있다
    assert.deepEqual(
      [st.dispatch.status, st.dispatch.computed, st.dispatch.goalZoneId, st.dispatch.durationS, st.dispatch.path.length],
      ['arrived', 'precomputed', 'Z1', route.duration_s, route.path.length],
    );
    const alert = st.alerts.find((x: { id: number }) => x.id === a.id);
    assert.equal(alert.status, 'arrived');
    assert.equal(st.zones.find((z: { id: string }) => z.id === 'Z1').alert, true);

    // 카드(SOS 화면) · 단말 목록에도 열린 알림
    assert.equal((await s.ok('GET', '/api/card?device=device-01')).alert.id, a.id);
    assert.equal((await s.ok('GET', '/api/inbox?device=device-01')).alert.id, a.id);
  });

  it('관제 확인은 기록용 (두 번 눌러도 처음 시각) → 처리 완료 → 로봇은 대기 위치로', async () => {
    const st = await s.ok('GET', '/api/state');
    const a = st.alerts.find((x: { type: string; status: string }) => x.type === 'fall' && x.status === 'arrived');
    const ack1 = await s.ok('POST', '/api/alert/ack', { alertId: a.id });
    const ack2 = await s.ok('POST', '/api/alert/ack', { alertId: a.id });
    assert.equal(ack1.acknowledgedAt, ack2.acknowledgedAt);

    const res = await s.ok('POST', '/api/alert/resolve', { alertId: a.id, resolution: 'handled' });
    assert.deepEqual([res.status, res.resolution], ['resolved', 'handled']);
    const after = await s.ok('GET', '/api/state');
    assert.deepEqual([after.robot.x, after.robot.y, after.robot.state], [3.3, 2.4, 'idle']);
    assert.equal(after.zones.find((z: { id: string }) => z.id === 'Z1').alert, false);

    const t = await todayTypes(s);
    const from = t.lastIndexOf('alert.raised');
    assert.deepEqual(t.slice(from), ['alert.raised', 'dispatch.started', 'dispatch.arrived', 'alert.acknowledged', 'alert.resolved']);
    const h = await s.ok('GET', '/api/history?day=today&cat=robot');
    assert.ok(h.events.some((e: { text: string }) => e.text === `로봇 Z1 도착 (${devRoute('home', 'Z1').duration_s.toFixed(1)}초)`));
  });

  it('로봇이 출동할 수 없으면 사람 출동 필요: 충전 중 · 구역 불명', async () => {
    const m = await s.ok('POST', '/api/robot/mode', { mode: 'charging' });
    assert.deepEqual(m, { mode: 'charging', battery: 82, available: false });
    let a = await s.ok('POST', '/api/event', { source: 'sos_button', deviceId: 'device-01' });
    assert.deepEqual([a.status, a.robotUnavailable, a.zoneId], ['no_robot', '충전 중', 'Z1']);
    const human = await s.ok('POST', '/api/alert/human', { alertId: a.id });
    assert.ok(human.humanDispatchedAt);
    assert.equal(human.acknowledgedAt, human.humanDispatchedAt); // 사람 출동 지시 = 관제 확인
    const again = await s.fail('POST', '/api/alert/human', { alertId: a.id }, 400);
    assert.equal(again.message, '이미 사람 출동을 지시했어요');
    await s.ok('POST', '/api/alert/resolve', { alertId: a.id, resolution: 'handled' });

    await s.ok('POST', '/api/robot/mode', { mode: 'ready' });
    a = await s.ok('POST', '/api/event', { source: 'operator' }); // 단말도 구역도 없다
    assert.deepEqual([a.status, a.robotUnavailable, a.zoneId, a.deviceId], ['no_robot', '구역 불명', null, null]);
    await s.ok('POST', '/api/alert/resolve', { alertId: a.id, resolution: 'false_alarm' });

    const bad = await s.fail('POST', '/api/robot/mode', { mode: 'flying' }, 400);
    assert.equal(bad.message, '알 수 없는 로봇 상태예요');
    const t = await todayTypes(s);
    assert.ok(t.includes('dispatch.unavailable') && t.includes('dispatch.human') && t.includes('robot.mode'));
  });
});

describe('C 가는 중: 오탐 해제(괜찮아요) · 다른 알림 · 직접 출동 (실제 시간)', () => {
  let s: TestServer;
  before(async () => {
    s = await startServer({ DISPATCH_SPEED: '1' });
    await startDemoWork(s);
  });
  after(() => s.close());

  it('가는 중에 오탐 해제하면 로봇이 멈추고 대기 위치로, 출동은 cancelled', async () => {
    const a = await s.ok('POST', '/api/event', { source: 'accel', deviceId: 'device-01' });
    const st = await waitFor(moving(s), 5000, '출발');
    assert.ok(st.robot.etaS > 0 && st.robot.etaS <= Math.ceil(devRoute('home', 'Z1').duration_s));
    assert.equal(st.robot.available, false);

    // 가는 중 새 쓰러짐: 로봇이 없다 → 사람 출동 필요
    const b = await s.ok('POST', '/api/event', { source: 'debug', zoneId: 'Z2' });
    assert.deepEqual([b.status, b.robotUnavailable], ['no_robot', '다른 알림에 출동 중']);
    await s.ok('POST', '/api/alert/resolve', { alertId: b.id, resolution: 'false_alarm' });

    const res = await s.ok('POST', '/api/alert/resolve', { alertId: a.id, resolution: 'false_alarm' });
    assert.equal(res.resolution, 'false_alarm');
    const after = await s.ok('GET', '/api/state');
    assert.deepEqual([after.robot.state, after.robot.x, after.robot.y, after.robot.available], ['idle', 3.3, 2.4, true]);
    assert.equal(after.dispatch.status, 'cancelled');
    assert.ok(after.dispatch.endedAt);
    // 이미 끝난 알림을 다시 끝내도 그대로
    assert.equal((await s.ok('POST', '/api/alert/resolve', { alertId: a.id })).resolution, 'false_alarm');
  });

  it('관제 직접 출동 (구역 지정) → 대기 위치에서 그 구역으로', async () => {
    const a = await s.ok('POST', '/api/event', { source: 'operator', zoneId: 'Z3' });
    assert.deepEqual([a.status, a.zoneId, a.workId], ['dispatched', 'Z3', null]);
    const st = await waitFor(moving(s), 5000, '출발');
    assert.deepEqual(st.dispatch.path, devRoute('home', 'Z3').path);
    await s.ok('POST', '/api/alert/resolve', { alertId: a.id });
    const bad = await s.fail('POST', '/api/event', { source: 'debug', zoneId: 'Z9' }, 400);
    assert.equal(bad.message, '없는 구역이에요: Z9');
    await s.fail('POST', '/api/alert/ack', { alertId: 999 }, 404);
  });
});

describe('C 계산 서비스: 실시간 · 1초 초과 → 사전 계산표', () => {
  it('route · simulate 가 응답하면 computed = live', async () => {
    const route = devRoute('home', 'Z2');
    const bodies: Record<string, unknown> = {};
    const fake = await fakeCompute((path, body) => {
      bodies[path] = body;
      if (path === '/health') return { ok: true };
      if (path === '/route') return { path: route.path, goal: route.goal, snapped: false };
      if (path === '/simulate') return { trajectory: route.trajectory, reached: true, duration_s: route.duration_s, distance_m: route.distance_m };
      throw new Error('not found');
    });
    const s = await startServer({ COMPUTE_URL: fake.url });
    try {
      assert.equal((await s.ok('GET', '/api/health')).compute.mode, 'live');
      await s.ok('POST', '/api/event', { source: 'debug', zoneId: 'Z2' });
      const st = await waitFor(arrived(s), 5000, '도착');
      assert.equal(st.dispatch.computed, 'live');
      assert.deepEqual(bodies['/route'], { zone: 'Z2', pose: [3.3, 2.4, Math.PI] });
      const h = await s.ok('GET', '/api/history?day=today&cat=robot');
      assert.ok(h.events.some((e: { text: string }) => e.text === '로봇 출동 → Z2 (실시간 계산 경로)'));
    } finally {
      await s.close();
      await fake.close();
    }
  });

  it('route 가 1초 안에 응답하지 않으면 사전 계산표로', async () => {
    const fake = await fakeCompute((path) => (path === '/health' ? { ok: true } : HANG));
    const s = await startServer({ COMPUTE_URL: fake.url });
    try {
      const t0 = Date.now();
      await s.ok('POST', '/api/event', { source: 'debug', zoneId: 'Z3' });
      const st = await waitFor(arrived(s), 8000, '도착');
      assert.ok(Date.now() - t0 >= 1000);
      assert.equal(st.dispatch.computed, 'precomputed');
    } finally {
      await s.close();
      await fake.close();
    }
  });
});

describe('서버 재시작 (같은 DB): 회차 · 상태 그대로, 가는 중이던 출동을 마무리', () => {
  it('재시작', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gx-pglite-'));
    const env = { PGLITE_DIR: dir, DISPATCH_SPEED: '2' };
    let s = await startServer(env);
    let session: string;
    try {
      session = (await s.ok('GET', '/api/health')).session;
      await s.ok('POST', '/api/card/opened', { workId: 9 });
      await s.ok('POST', '/api/event', { source: 'debug', zoneId: 'Z2' }); // 3.79초 / 2배속
      await waitFor(moving(s), 5000, '출발');
    } finally {
      await s.close(); // 가는 중에 끈다
    }
    s = await startServer(env);
    try {
      assert.equal((await s.ok('GET', '/api/health')).session, session!);
      assert.equal((await s.ok('GET', '/api/card?device=device-01')).work.status, 'opened');
      const st = await waitFor(arrived(s), 6000, '재시작 뒤 도착');
      assert.deepEqual([st.robot.x, st.robot.y], devRoute('home', 'Z2').trajectory.at(-1)!.slice(1, 3));
      const t = await todayTypes(s);
      assert.equal(t.filter((x) => x === 'dispatch.arrived').length, 1);
    } finally {
      await s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
