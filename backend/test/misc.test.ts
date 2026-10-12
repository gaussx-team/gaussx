import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dataUrl, JPEG_3x2, PDF, startDemoWork, startServer, type TestServer } from './helpers.js';

describe('도면', () => {
  let s: TestServer;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it('목록: 데모 도면 4장 (프론트 정적 파일)', async () => {
    const d = await s.ok('GET', '/api/drawings');
    assert.deepEqual(d.zones.map((z: { id: string }) => z.id), ['Z1', 'Z2', 'Z3']);
    assert.deepEqual(
      d.drawings.map((x: { dwgNo: string; kind: string; url: string; cad: boolean; mapsToFloor: boolean }) => [x.dwgNo, x.kind, x.url, x.cad, x.mapsToFloor]),
      [
        ['A-101', 'floor', '/drawings/floor-plan.svg', false, true],
        ['P-201', 'pid', '/drawings/pid-z1.svg', false, false],
        ['E-301', 'electrical', '/drawings/sld-mcc3.svg', false, false],
        ['E-301', 'electrical', '/drawings/sld-mcc3.svg', true, false],
      ],
    );
    assert.deepEqual(d.drawings[0].zoneIds, ['Z1', 'Z2', 'Z3']);
    assert.deepEqual(d.drawings[1].equipment, ['P-203', 'V-11']);
  });

  it('등록 (base64) → 보기 주소는 백엔드 절대 주소 · CAD 원본은 내려받기 · 카드에 연결', async () => {
    let r = await s.fail('POST', '/api/drawing', { title: ' ', dataBase64: 'eA==' }, 400);
    assert.equal(r.message, '도면 이름을 입력해 주세요');
    r = await s.fail('POST', '/api/drawing', { title: 'x' }, 400);
    assert.equal(r.message, '파일을 골라 주세요');

    const pdf = await s.ok('POST', '/api/drawing', {
      title: '2구역 탱크 배치도', kind: 'floor', dwgNo: 'A-102', revision: 'REV.A', zoneIds: ['Z2'], equipment: ['T-02', ' ', 'PU-07'],
      fileName: 'A-102_탱크.pdf', mime: 'application/pdf', dataBase64: PDF.toString('base64'),
    });
    assert.equal(pdf.url, `${s.base}/api/drawing/file?id=${pdf.id}`);
    assert.deepEqual([pdf.equipment, pdf.zoneIds, pdf.cad, pdf.uploadedBy], [['T-02', 'PU-07'], ['Z2'], false, '담당자']);
    const file = await fetch(pdf.url);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.match(file.headers.get('content-disposition') ?? '', /^inline; filename\*=UTF-8''A-102_/);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PDF);

    const dwg = await s.ok('POST', '/api/drawing', { title: '원본', kind: 'other', fileName: 'A-102.dwg', mime: '', dataBase64: 'AAEC' });
    assert.equal(dwg.cad, true);
    assert.match((await fetch(dwg.url)).headers.get('content-disposition') ?? '', /^attachment/);
    await s.fail('GET', '/api/drawing/file?id=1', undefined, 404); // 데모 도면은 프론트가 가진 파일

    // 2구역 작업(W-007, PU-07) 상세에 새 도면이 걸린다
    const detail = await s.ok('GET', '/api/work/7');
    assert.ok(detail.drawings.some((x: { id: number }) => x.id === pdf.id));
    const h = await s.ok('GET', '/api/history?day=today&cat=system');
    assert.ok(h.events.some((e: { type: string; text: string }) => e.type === 'drawing.uploaded' && e.text === '2구역 탱크 배치도 (A-102_탱크.pdf) 등록'));
  });

  it('파일 올리기 (multipart) → 확인에 photoMediaId 로', async () => {
    const form = new FormData();
    form.append('kind', 'confirm_photo');
    form.append('file', new Blob([new Uint8Array(JPEG_3x2)]), '보호구.jpg');
    const up = await fetch(`${s.base}/api/media`, { method: 'POST', body: form });
    const m = (await up.json()) as { mediaId: number; url: string };
    assert.equal(up.status, 200);
    assert.match(m.url, /\.jpg$/);
    await s.ok('POST', '/api/card/opened', { workId: 9 });
    const c = await s.ok('POST', '/api/confirm', { workId: 9, checkItemId: 15, photoMediaId: m.mediaId });
    assert.equal(c.photo, m.url);
    const bad = await s.fail('POST', '/api/confirm', { workId: 9, checkItemId: 16, photo: dataUrl('application/pdf', PDF) }, 400);
    assert.equal(bad.message, '사진 파일을 올려 주세요');
  });
});

describe('이력 · 상태 · 설정', () => {
  let s: TestServer;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it('이력 필터: 날짜(KST) · 종류 · 구역 · 작업 · 검색어', async () => {
    const all = await s.ok('GET', '/api/history?day=all');
    assert.equal(all.day, 'all');
    assert.match(all.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(all.works.length, 9);
    // 최신 순
    for (let i = 1; i < all.events.length; i++) assert.ok(all.events[i - 1].at >= all.events[i].at);

    const robot = await s.ok('GET', '/api/history?day=all&cat=robot');
    assert.ok(robot.events.length >= 4);
    assert.ok(robot.events.every((e: { type: string; category: string }) => e.category === 'robot' && /^(dispatch|robot)\./.test(e.type)));

    const w3 = await s.ok('GET', '/api/history?day=all&work=3');
    assert.ok(w3.events.length > 0);
    assert.ok(w3.events.every((e: { workCode: string }) => e.workCode === 'W-003'));
    // 알림 기록(출동 · 도착)은 알림의 작업으로 묶인다
    assert.ok(w3.events.some((e: { type: string }) => e.type === 'dispatch.arrived'));

    const z2 = await s.ok('GET', '/api/history?day=all&zone=Z2');
    assert.ok(z2.events.every((e: { zoneId: string }) => e.zoneId === 'Z2'));
    const q = await s.ok('GET', '/api/history?day=all&q=pu-07');
    assert.ok(q.events.length > 0 && q.events.every((e: { text: string; actor: string; workCode: string | null }) => `${e.text} ${e.actor} ${e.workCode}`.toLowerCase().includes('pu-07')));

    // 6일 전: 지난 작업 W-001 (MCC-3 정기 점검)
    const day = new Date(Date.now() + 9 * 3600_000 - 6 * 86_400_000).toISOString().slice(0, 10);
    const d6 = await s.ok('GET', `/api/history?day=${day}`);
    assert.ok(d6.events.length > 0 && d6.events.every((e: { workCode: string }) => e.workCode === 'W-001'));

    const bad = await s.fail('GET', '/api/history?day=2026-13-45', undefined, 400);
    assert.equal(bad.message, '날짜는 YYYY-MM-DD · today · all 중 하나예요');
  });

  it('상태: 오늘 타임라인 30개 · 최근 알림 10개 · 구역 색', async () => {
    const st = await s.ok('GET', '/api/state');
    assert.ok(st.events.length > 0 && st.events.length <= 30);
    assert.equal(st.events[0].type, 'session.reset');
    assert.deepEqual(st.alerts.map((a: { id: number }) => a.id), [2, 1]);
    assert.deepEqual(st.zones.map((z: { workState: string }) => z.workState), ['planned', 'working', 'planned']);
    assert.ok(st.works.every((w: { done: number; total: number; requiredLeft: number }) => w.total >= w.done && w.requiredLeft >= 0));
  });

  it('설정 · 단말 · 상태 확인 · 문서', async () => {
    assert.deepEqual(await s.ok('GET', '/api/devices'), [
      { id: 'device-01', label: '단말 1번', kind: 'phone' },
      { id: 'device-02', label: '단말 2번', kind: 'phone' },
    ]);
    const c = await s.ok('GET', '/api/config');
    assert.deepEqual([c.site.id, c.robot.home, c.precomputedRoutes], ['demo', [3.3, 2.4], 9]);
    assert.match(c.session, /^gx_\d{8}_\d{6}$/);
    const docs = await fetch(`${s.base}/docs`);
    assert.equal(docs.status, 200);
    const spec = await s.ok('GET', '/docs-json');
    // 프론트 목업의 API 25개가 모두 있다
    const want = [
      ['get', '/api/state'], ['get', '/api/card'], ['post', '/api/card/opened'], ['post', '/api/confirm'], ['get', '/api/inbox'],
      ['post', '/api/work'], ['get', '/api/work/{id}'], ['post', '/api/work/complete'], ['post', '/api/work/end'], ['post', '/api/work/cancel'],
      ['get', '/api/tags'], ['post', '/api/tag'], ['post', '/api/tag/revise'], ['post', '/api/tag/verify'],
      ['post', '/api/event'], ['post', '/api/alert/ack'], ['post', '/api/alert/resolve'], ['post', '/api/alert/human'], ['post', '/api/robot/mode'],
      ['get', '/api/drawings'], ['post', '/api/drawing'], ['get', '/api/drawing/file'], ['get', '/api/history'], ['post', '/api/debug/reset'],
    ];
    for (const [m, p] of want) assert.ok(spec.paths[p]?.[m], `${m.toUpperCase()} ${p} 가 없습니다`);
    const preflight = await fetch(`${s.base}/api/state`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' } });
    assert.ok(preflight.headers.get('access-control-allow-origin')); // 프론트(3000)에서 부를 수 있다
    assert.equal(preflight.headers.get('access-control-max-age'), '3600'); // 사전 요청은 1시간 기억
  });
});

describe('데모 리셋 = 새 회차 (기록은 지우지 않는다)', () => {
  let s: TestServer;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it('리셋하면 처음 상태, 지난 회차 기록은 자기 스키마에 그대로', async () => {
    const first = (await s.ok('GET', '/api/health')).session;
    await startDemoWork(s);
    const a = await s.ok('POST', '/api/event', { source: 'sos_button', deviceId: 'device-01' });
    assert.equal(a.zoneId, 'Z1');

    const r = await s.ok('POST', '/api/debug/reset', {});
    assert.equal(r.ok, true);
    assert.notEqual(r.session, first);
    const st = await s.ok('GET', '/api/state');
    assert.equal(st.works.find((w: { id: number }) => w.id === 9).status, 'published');
    assert.deepEqual(st.alerts.map((x: { id: number }) => x.id), [2, 1]); // 데모 데이터의 지난 알림만
    assert.deepEqual([st.robot.state, st.robot.x, st.robot.y], ['idle', 3.3, 2.4]);
    assert.equal(st.events[0].text, `데모 리셋 · 새 회차 ${r.session}`);

    const list = await s.ok('GET', '/api/debug/sessions');
    assert.equal(list.current, r.session);
    assert.deepEqual(list.sessions.map((x: { name: string }) => x.name), [r.session, first]);
    // 지난 회차: 확인 · 알림 · 기록이 그대로 남아 있다
    const [old] = await s.db.query<{ confirms: number; alerts: number; events: number }>(
      `SELECT (SELECT count(*)::int FROM ${first}.confirmation WHERE work_id = 9) AS confirms,
              (SELECT count(*)::int FROM ${first}.alert) AS alerts,
              (SELECT count(*)::int FROM ${first}.event) AS events`,
    );
    assert.deepEqual([old.confirms, old.alerts], [4, 3]);
    assert.ok(old.events > 60);
  });
});
