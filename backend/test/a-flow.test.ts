import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DEMO, dataUrl, JPEG_3x2, PDF, startServer, type TestServer } from './helpers.js';

// 프론트 목업(frontend/src/lib/server/store.ts)과 같은 동작인지: 태그 → 작업 등록 → 카드 → 확인 → 작업 시작 → 종료

describe('A 작업 카드: 데모 작업 W-009 (device-01 · 1구역)', () => {
  let s: TestServer;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it('단말의 작업 목록 · 카드 (프론트 Inbox · CardView 가 받는 모양)', async () => {
    const inbox = await s.ok('GET', '/api/inbox?device=device-01');
    assert.equal(inbox.deviceId, 'device-01');
    assert.deepEqual(inbox.works.map((w: { code: string }) => w.code), ['W-009', 'W-008']); // 열린 작업, 최근 순
    assert.equal(inbox.alert, null);
    assert.ok(typeof inbox.now === 'string');

    const card = await s.ok('GET', '/api/card?device=device-01');
    assert.equal(card.work.code, 'W-009');
    assert.equal(card.work.status, 'published');
    assert.equal(card.work.permitName, '작업허가서_예시.pdf');
    assert.ok(card.work.permitStart < card.work.permitEnd);
    assert.deepEqual(card.zone, { id: 'Z1', siteId: 'demo', name: '1구역 · 배관', color: null, rect: [0, 0, 2, 1.5] });
    assert.deepEqual(card.tags.map((t: { id: number; version: number }) => [t.id, t.version]), [[7, 2], [2, 1]]);
    const pressure = card.tags[0].checkItems[0];
    assert.deepEqual(
      [pressure.id, pressure.needs, pressure.unit, pressure.required, pressure.min, pressure.max, pressure.maxExclusive],
      [DEMO.pressure, 'value', 'bar', true, 0, 0, false],
    );
    assert.deepEqual(card.tags[1].checkItems[0], {
      id: DEMO.oxygen, tagId: 2, seq: 1, item: '산소 농도 측정', needs: 'value', unit: '%', required: true, min: 18, max: 23.5, maxExclusive: true,
    });
    assert.deepEqual(card.confirmations, []);
    assert.deepEqual(card.abnormal, []);
    assert.equal(card.robot.mode, 'ready');
    assert.deepEqual(card.drawings.map((d: { title: string }) => d.title), ['데모 현장 평면도', '1구역 HF 이송 라인 P&ID']);
    assert.equal(card.drawings[0].url, '/drawings/floor-plan.svg'); // 프론트가 가진 정적 파일
  });

  it('열람 → 측정 이상(거부 + 관제 알림) → 재측정 → 체크인 → 필수 확인 → 작업 시작', async () => {
    const opened = await s.ok('POST', '/api/card/opened', { workId: DEMO.work });
    assert.equal(opened.status, 'opened');
    assert.ok(opened.openedAt);

    let r = await s.fail('POST', '/api/work/complete', { workId: DEMO.work }, 400);
    assert.equal(r.message, '필수 항목을 모두 확인해야 작업을 시작할 수 있어요');

    // 잔압에 3 → 거부 + 측정 이상 알림 (로봇 출동 없음)
    r = await s.fail('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.pressure, value: 3 }, 400);
    assert.equal(r.message, '정상 범위(0bar)를 벗어났어요. 관제에 자동으로 알렸어요 — 다시 측정해 정상이면 진행할 수 있어요');
    let state = await s.ok('GET', '/api/state');
    const abn = state.alerts.find((a: { type: string }) => a.type === 'abnormal');
    assert.deepEqual(
      [abn.status, abn.source, abn.zoneId, abn.workId, abn.reading.value, abn.reading.range, abn.reading.tagTitle, abn.reading.item],
      ['open', 'reading', 'Z1', DEMO.work, 3, '0bar', '배관 P-203', '배관 잔압 0 확인'],
    );
    assert.equal(state.zones.find((z: { id: string }) => z.id === 'Z1').warning, true);
    assert.equal(state.robot.state, 'idle');

    // 다시 이상값 → 같은 알림의 값만 바뀐다
    await s.fail('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.pressure, value: 5 }, 400);
    state = await s.ok('GET', '/api/state');
    const abns = state.alerts.filter((a: { type: string }) => a.type === 'abnormal');
    assert.equal(abns.length, 1);
    assert.equal(abns[0].reading.value, 5);

    // 재측정 정상 → 확인 저장 + 첫 확인 = 체크인 + 측정 이상에 재측정 표시 (알림 종료는 관제가)
    const c1 = await s.ok('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.pressure, value: 0 });
    assert.deepEqual([c1.workId, c1.tagId, c1.checkItemId, c1.value, c1.deviceId], [DEMO.work, 7, DEMO.pressure, 0, 'device-01']);
    const card = await s.ok('GET', '/api/card?device=device-01');
    assert.ok(card.work.checkedInAt);
    assert.equal(card.abnormal.length, 1);
    assert.equal(card.abnormal[0].reading.recheckedValue, 0);
    assert.ok(card.abnormal[0].reading.recheckedAt);

    r = await s.fail('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.lockPhoto }, 400);
    assert.equal(r.message, '사진이 필요한 항목이에요');
    r = await s.fail('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.oxygen, value: 23.5 }, 400); // 23.5% 미만
    assert.match(r.message, /^정상 범위\(18% 이상 23\.5% 미만\)를 벗어났어요/);
    r = await s.fail('POST', '/api/confirm', { workId: DEMO.work, checkItemId: 9 }, 400); // 다른 작업(MCC-3)의 항목
    assert.equal(r.message, '이 작업에 없는 확인 항목이에요');

    // 사진은 data URL 로 보내면 파일로 저장된다 (이름만 보내면 이름만 남는다: 목업 호환)
    const photo = await s.ok('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.lockPhoto, photo: dataUrl('image/jpeg', JPEG_3x2) });
    assert.match(photo.photo, new RegExp(`^${s.base}/media/gx_\\d{8}_\\d{6}/[0-9a-f]{12}\\.jpg$`));
    assert.deepEqual(Buffer.from(await (await fetch(photo.photo)).arrayBuffer()), JPEG_3x2);
    await s.ok('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.ppe });
    r = await s.fail('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.ppe }, 400);
    assert.equal(r.message, '이미 확인한 항목이에요 (수정 불가)');
    await s.ok('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.oxygen, value: 18 });

    // 선택 항목(세안 설비)이 남아도 시작할 수 있다
    const started = await s.ok('POST', '/api/work/complete', { workId: DEMO.work });
    assert.deepEqual([started.status, started.done, started.total, started.requiredLeft], ['confirmed', 4, 5, 0]);
    assert.ok(started.confirmedAt);
    r = await s.fail('POST', '/api/work/complete', { workId: DEMO.work }, 400);
    assert.equal(r.message, '이미 작업이 시작됐어요');
    // 시작한 뒤에도 남은 선택 항목은 확인할 수 있다
    await s.ok('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.eyewash });

    state = await s.ok('GET', '/api/state');
    assert.equal(state.zones.find((z: { id: string }) => z.id === 'Z1').workState, 'working');
  });

  it('한 단말에서 작업 중은 하나만 → 먼저 종료해야 다른 작업을 시작한다', async () => {
    // W-008 (MCC-3 차단기 교체): 사진 · 무전압 0V · 장갑
    await s.ok('POST', '/api/confirm', { workId: 8, checkItemId: 9, photo: 'breaker.jpg' });
    await s.ok('POST', '/api/confirm', { workId: 8, checkItemId: 10, value: 0 });
    await s.ok('POST', '/api/confirm', { workId: 8, checkItemId: 11 });
    const r = await s.fail('POST', '/api/work/complete', { workId: 8 }, 400);
    assert.equal(r.message, 'W-009 작업이 진행 중이에요. 먼저 종료한 뒤 시작해 주세요');

    const ended = await s.ok('POST', '/api/work/end', { workId: DEMO.work });
    assert.equal(ended.status, 'ended');
    assert.ok(ended.endedAt);
    const again = await s.fail('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.eyewash }, 400);
    assert.equal(again.message, '이미 종료된 작업이에요');
    assert.equal((await s.ok('POST', '/api/work/complete', { workId: 8 })).status, 'confirmed');

    const inbox = await s.ok('GET', '/api/inbox?device=device-01');
    assert.deepEqual(inbox.works.map((w: { code: string; status: string }) => `${w.code}:${w.status}`), ['W-009:ended', 'W-008:confirmed']);
  });

  it('작업 상세 · 이력에 전부 남는다 (거부된 값까지)', async () => {
    const d = await s.ok('GET', `/api/work/${DEMO.work}`);
    assert.equal(d.work.code, 'W-009');
    assert.equal(d.confirmations.length, 5);
    // 측정 이상 알림 2건: 잔압(3 → 5, 같은 알림) · 산소(23.5)
    assert.deepEqual(d.alerts.map((a: { type: string; reading: { item: string } }) => `${a.type}:${a.reading.item}`), [
      'abnormal:배관 잔압 0 확인', 'abnormal:산소 농도 측정',
    ]);
    assert.deepEqual(d.dispatches, []);
    assert.deepEqual(d.drawings.length, 2);
    const t = d.events.map((e: { type: string }) => e.type).reverse();
    assert.deepEqual(t, [
      'work.published', 'card.opened', 'check.rejected', 'alert.abnormal', 'check.rejected', 'work.checked_in', 'check.confirmed',
      'check.rejected', 'alert.abnormal', 'check.confirmed', 'check.confirmed', 'check.confirmed', 'work.confirmed', 'check.confirmed',
      'work.ended',
    ]);
    const texts = d.events.map((e: { text: string }) => e.text);
    assert.ok(texts.includes('배관 P-203 · 배관 잔압 0 확인 · 3bar (정상 0bar)'));
    assert.ok(texts.includes('배관 P-203 · 배관 잔압 0 확인 · 0bar (재측정)'));
    assert.ok(texts.includes('W-009 체크인 · Z1'));

    const h = await s.ok('GET', '/api/history?day=today&cat=check&work=9');
    assert.ok(h.events.every((e: { category: string; workCode: string }) => e.category === 'check' && e.workCode === 'W-009'));
    assert.equal(h.events.length, 8);
  });

  it('측정 이상 알림은 관제가 확인 · 처리 완료로 닫는다 (로봇과 무관)', async () => {
    const state = await s.ok('GET', '/api/state');
    const abns = state.alerts.filter((a: { type: string; status: string }) => a.type === 'abnormal' && a.status === 'open');
    assert.equal(abns.length, 2);
    for (const abn of abns) {
      assert.ok((await s.ok('POST', '/api/alert/ack', { alertId: abn.id })).acknowledgedAt);
      const res = await s.ok('POST', '/api/alert/resolve', { alertId: abn.id, resolution: 'handled' });
      assert.deepEqual([res.status, res.resolution], ['resolved', 'handled']);
    }
    const after = await s.ok('GET', '/api/state');
    assert.equal(after.zones.find((z: { id: string }) => z.id === 'Z1').warning, false);
    assert.deepEqual([after.robot.x, after.robot.y], [3.3, 2.4]);
  });
});

describe('A 작업 등록 · 취소 · 태그 버전 · 승인', () => {
  let s: TestServer;
  before(async () => {
    s = await startServer();
  });
  after(() => s.close());

  it('작업 등록: 구역 · 단말 · 태그 · 허가 시간 · 허가서 파일', async () => {
    let r = await s.fail('POST', '/api/work', { title: '', zoneId: 'Z2', deviceId: 'device-02', tagIds: [3] }, 400);
    assert.equal(r.message, '작업명을 입력해 주세요');
    r = await s.fail('POST', '/api/work', { title: 'x', zoneId: 'Z9', deviceId: 'device-02', tagIds: [3] }, 400);
    assert.equal(r.message, '구역을 선택해 주세요');
    r = await s.fail('POST', '/api/work', { title: 'x', zoneId: 'Z2', deviceId: 'device-02', tagIds: [] }, 400);
    assert.equal(r.message, '태그를 1개 이상 묶어 주세요');
    r = await s.fail('POST', '/api/work', { title: 'x', zoneId: 'Z1', deviceId: 'device-02', tagIds: [1] }, 400); // P-203 v1 (대체됨)
    assert.equal(r.message, '수정된 예전 버전 태그가 섞여 있어요. 화면을 새로고침해 주세요');
    r = await s.fail('POST', '/api/work', { title: 'x', zoneId: 'Z2', deviceId: 'device-02', tagIds: [3], permitStart: 'nope' }, 400);
    assert.match(r.message, /^요청 형식이 잘못됐어요: permitStart/);

    const w = await s.ok('POST', '/api/work', {
      title: 'T-02 탱크 내부 점검', zoneId: 'Z2', deviceId: 'device-02', tagIds: [3, 4], permitName: '허가서.pdf',
      permitFile: dataUrl('application/pdf', PDF), permitStart: '2026-11-05T09:00:00+09:00', permitEnd: '2026-11-05T17:00:00+09:00',
    });
    assert.equal(w.code, 'W-010');
    assert.deepEqual([w.status, w.zoneId, w.deviceId, w.tagIds, w.done, w.total, w.requiredLeft], ['published', 'Z2', 'device-02', [3, 4], 0, 3, 3]);
    assert.match(w.permitFileUrl, /\.pdf$/);
    assert.equal(w.permitStart, '2026-11-05T00:00:00.000Z');

    r = await s.fail('POST', '/api/work', { title: 'x', zoneId: 'Z2', deviceId: 'device-02', tagIds: [3], permitFile: dataUrl('image/png', JPEG_3x2) }, 400);
    assert.equal(r.message, '작업허가서는 PDF 파일만 받아요');
  });

  it('취소: 시작 전만 · 사유 필수', async () => {
    let r = await s.fail('POST', '/api/work/cancel', { workId: 10, reason: ' ' }, 400);
    assert.equal(r.message, '취소 사유를 적어 주세요');
    const c = await s.ok('POST', '/api/work/cancel', { workId: 10, reason: '자재 미입고' });
    assert.deepEqual([c.status, c.cancelReason], ['cancelled', '자재 미입고']);
    r = await s.fail('POST', '/api/work/cancel', { workId: 7, reason: '그냥' }, 400); // W-007 작업 중
    assert.equal(r.message, '작업이 시작된 뒤에는 취소할 수 없어요. 작업 종료로 처리해 주세요');
    r = await s.fail('POST', '/api/confirm', { workId: 10, checkItemId: 6, photo: 'x.jpg' }, 400);
    assert.equal(r.message, '취소된 작업이에요');
    await s.fail('GET', '/api/work/999', undefined, 404);
  });

  it('태그: 만들기 → 승인 → 수정은 새 버전 (예전 버전 보관, 보낸 작업은 예전 버전 유지)', async () => {
    let r = await s.fail('POST', '/api/tag', { zoneId: 'Z3', title: '', hazard: '', x: 1, y: 2, checkItems: [{ item: 'a' }] }, 400);
    assert.equal(r.message, '설비 이름과 위험 문구는 필수예요');
    r = await s.fail('POST', '/api/tag', { zoneId: 'Z3', title: 'A', hazard: 'B', x: 1, y: 2, checkItems: [] }, 400);
    assert.equal(r.message, '작업 전 확인 항목이 1개 이상 필요해요');
    r = await s.fail('POST', '/api/tag', { zoneId: 'Z3', title: 'A', hazard: 'B', x: 'left', y: 2, checkItems: [{ item: 'a' }] }, 400);
    assert.match(r.message, /^요청 형식이 잘못됐어요: x/);

    // 프론트 태그 화면이 보내는 그대로 (빈 문자열 · 템플릿 항목)
    const t = await s.ok('POST', '/api/tag', {
      zoneId: 'Z3', title: '배전반 LP-2', substance: '', hazard: '감전 위험', emergencyNote: '', equipmentState: 'running', official: false,
      x: 1.1, y: 2.2,
      checkItems: [
        { item: '가연성 가스 농도 측정', needs: 'value', unit: '%LEL', required: true, min: 0, max: 10, maxExclusive: true },
        { item: '소화기 비치', needs: 'none', required: true },
      ],
    });
    assert.deepEqual([t.version, t.official, t.verifiedAt, t.substance, t.emergencyNote, t.replacesId], [1, false, null, null, null, null]);
    assert.deepEqual(t.checkItems.map((c: { min: number; max: number; maxExclusive: boolean }) => [c.min, c.max, c.maxExclusive]), [[0, 10, true], [null, null, false]]);

    const v = await s.ok('POST', '/api/tag/verify', { tagId: t.id });
    assert.deepEqual([v.official, v.verifiedBy], [true, '원청 안전팀']);
    r = await s.fail('POST', '/api/tag/verify', { tagId: t.id }, 400);
    assert.equal(r.message, '이미 공식 태그예요');

    // P-203 v2(7) 를 고친다 → v3. 이미 보낸 W-009 는 v2 를 계속 가리킨다
    const v3 = await s.ok('POST', '/api/tag/revise', { tagId: 7, patch: { hazard: '피부 접촉 시 중증 화상 · 증기 흡입 주의' } });
    assert.deepEqual([v3.version, v3.replacesId, v3.title, v3.official, v3.checkItems.length], [3, 7, '배관 P-203', true, 4]);
    r = await s.fail('POST', '/api/tag/revise', { tagId: 7, patch: { hazard: 'x' } }, 400);
    assert.equal(r.message, '이미 수정된 예전 버전이에요. 최신 버전에서 수정해 주세요');
    r = await s.fail('POST', '/api/tag/verify', { tagId: 1 }, 400);
    assert.equal(r.message, '예전 버전은 승인할 수 없어요');

    const tags = await s.ok('GET', '/api/tags');
    assert.ok(tags.tags.some((x: { id: number }) => x.id === v3.id));
    assert.deepEqual(tags.history.map((x: { id: number }) => x.id), [1, 7]);
    assert.deepEqual(tags.works.find((w: { code: string }) => w.code === 'W-009').tagIds, [7, 2]);
    const card = await s.ok('GET', '/api/card?work=9');
    assert.deepEqual(card.tags.map((x: { id: number; status: string }) => [x.id, x.status]), [[7, 'superseded'], [2, 'active']]);
  });
});
