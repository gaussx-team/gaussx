import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ConfigSync } from '../src/config/config-sync.service.js';
import { loadScene } from '../src/config/scene.js';
import { type Db, openDb } from '../src/db/db.js';
import { EventsService } from '../src/db/events.service.js';
import { migrate } from '../src/db/migrate.js';
import { DEV_SCENE_DIR } from '../src/paths.js';
import { Seeder } from '../src/seed/seeder.js';

// DDL(db/migrations/0000_init.sql)을 실제 PostgreSQL 에 넣고, 데모 데이터(scenes/dev/demo/seed.json)를 넣고,
// "화면만 믿지 않고 DB 에서도 막는" 규칙을 고정한다. 기본은 PGlite(PostgreSQL 17.5).
// 설치한 PostgreSQL 로: TEST_DATABASE_URL=postgres://…/빈DB npm test (스키마 gx_rules 를 새로 만든다)

const SCHEMA = 'gx_rules';
let db: Db;

async function blocked(sql: string, code: string, message?: string) {
  await assert.rejects(db.query(sql), (e: { code?: string; message?: string }) => {
    assert.equal(e.code, code, `SQLSTATE 가 다릅니다: ${e.code} ${e.message}`);
    if (message) assert.ok(e.message?.includes(message), `메시지에 "${message}" 가 없습니다: ${e.message}`);
    return true;
  });
}

describe('DB 규칙 — DDL v5 · 데모 데이터 · 막혀야 할 쓰기', () => {
  before(async () => {
    db = await openDb({ databaseUrl: process.env.TEST_DATABASE_URL || null, pgliteDir: 'memory://' });
    await db.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);
    await migrate(db, SCHEMA);
    await db.useSchema(SCHEMA);
    const scene = loadScene(DEV_SCENE_DIR);
    await new ConfigSync(db, scene).sync();
    await new Seeder(db, scene, new EventsService(scene)).seed();
  });
  after(() => db?.close());

  it('PostgreSQL 17 에서 돈다 (팀 결정과 같은 메이저 버전)', async () => {
    const [{ v }] = await db.query<{ v: string }>("SELECT current_setting('server_version') AS v");
    assert.match(v, /^17\./);
  });

  it('데모 데이터가 규칙 위반 없이 들어간다 (프론트 목업과 같은 양)', async () => {
    const tables = ['site', 'scan', 'zone', 'device', 'robot', 'tag', 'check_item', 'work', 'work_tag', 'confirmation',
      'alert', 'dispatch', 'drawing', 'drawing_zone'];
    const rows = await db.query<{ t: string; n: number }>(
      tables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n FROM ${t}`).join(' UNION ALL '),
    );
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.t, r.n])), {
      site: 1, scan: 1, zone: 3, device: 2, robot: 1, tag: 7, check_item: 17, work: 9, work_tag: 11, confirmation: 16,
      alert: 2, dispatch: 2, drawing: 4, drawing_zone: 6,
    });
    const works = await db.query<{ code: string; status: string }>('SELECT code, status FROM work ORDER BY id');
    assert.deepEqual(works.map((w) => `${w.code}:${w.status}`), [
      'W-001:ended', 'W-002:ended', 'W-003:ended', 'W-004:ended', 'W-005:ended', 'W-006:ended', 'W-007:confirmed',
      'W-008:published', 'W-009:published',
    ]);
    const tags = await db.query<{ id: number; version: number; status: string; supersedes_tag_id: number | null }>(
      'SELECT id, version, status, supersedes_tag_id FROM tag WHERE id IN (1, 7) ORDER BY id',
    );
    assert.deepEqual(tags, [
      { id: 1, version: 1, status: 'superseded', supersedes_tag_id: null },
      { id: 7, version: 2, status: 'active', supersedes_tag_id: 1 },
    ]);
  });

  // ── 막혀야 할 쓰기 ────────────────────────────────────────────
  const C = 'INSERT INTO confirmation (work_id, tag_id, check_item_id, value, photo_name, confirmed_by) VALUES';
  const BLOCKED: [string, string, string, string?][] = [
    ['값이 필요한 항목을 값 없이 확인', `${C} (9, 7, 14, NULL, NULL, '작업반장')`, '23514', '값이 필요한 항목이에요'],
    ['정상 범위 밖 값 (잔압 0 이어야 하는데 3)', `${C} (9, 7, 14, 3, NULL, '작업반장')`, '23514', '정상 범위를 벗어난 값'],
    ['정상 범위 밖 값 (산소 23.5% 미만인데 23.5)', `${C} (9, 2, 5, 23.5, NULL, '작업반장')`, '23514', '정상 범위를 벗어난 값'],
    ['사진이 필요한 항목을 사진 없이 확인', `${C} (9, 7, 15, NULL, NULL, '작업반장')`, '23514', '사진이 필요한 항목이에요'],
    ['작업에 묶이지 않은 태그를 확인', `${C} (9, 3, 6, NULL, 'x.jpg', '작업반장')`, '23503', 'confirmation_work_id_tag_id_fkey'],
    ['다른 태그의 항목을 섞어 확인', `${C} (9, 7, 5, 20.8, NULL, '작업반장')`, '23503', 'confirmation_tag_id_check_item_id_fkey'],
    ['같은 항목을 두 번 확인', `${C} (1, 5, 11, NULL, NULL, '작업반장')`, '23505', 'confirmation_work_id_check_item_id_key'],
    ['확인 기록 수정', 'UPDATE confirmation SET value = 1 WHERE id = 2', '23514', '기록은 고치거나 지울 수 없어요'],
    ['확인 기록 삭제', 'DELETE FROM confirmation WHERE id = 1', '23514', '기록은 고치거나 지울 수 없어요'],
    ['이벤트 수정', "UPDATE event SET actor = '누군가' WHERE seq = 1", '23514', '기록은 고치거나 지울 수 없어요'],
    ['이벤트 삭제', 'DELETE FROM event WHERE seq = 1', '23514', '기록은 고치거나 지울 수 없어요'],
    ['작업에 묶인 태그 바꾸기', 'UPDATE work_tag SET tag_id = 3 WHERE work_id = 9 AND tag_id = 2', '23514', '기록은 고치거나 지울 수 없어요'],
    ['태그 내용 수정', "UPDATE tag SET hazard = '문구만 살짝' WHERE id = 7", '23514', '태그는 고치지 않고 새 버전을 만들어요'],
    ['대체된 예전 버전을 다시 살리기', "UPDATE tag SET status = 'active', superseded_at = NULL WHERE id = 1", '23514', '대체된 예전 버전은 바꿀 수 없어요'],
    ['승인을 되돌리기', 'UPDATE tag SET official = false, verified_by = NULL, verified_at = NULL WHERE id = 7', '23514', '승인된 태그의 확인 정보'],
    ['승인하지 않고 확인 정보만 채우기', "UPDATE tag SET verified_by = '누군가' WHERE id = 3", '23514', '승인하지 않고'],
    ['한 현장에 활성 스캔 둘', "INSERT INTO scan (id, site_id, scene_dir, is_active) VALUES ('dev2', 'demo', 'x', true)", '23505', 'scan_one_active'],
    ['위치 이동 이벤트 (zone.changed)', "INSERT INTO event (site_id, type, actor, text) VALUES ('demo', 'zone.changed', 'device-01', 'x')", '23514', 'event_type_check'],
    ['깨진 JSON', "INSERT INTO event (site_id, type, actor, text, payload) VALUES ('demo', 'session.reset', 'system', 'x', '{bad')", '22P02'],
    [
      '알림 하나에 출동 둘',
      `INSERT INTO dispatch (alert_id, robot_id, scan_id, goal_zone_id, computed, start_x, start_y, start_yaw_rad, goal_x, goal_y, snapped, path)
       VALUES (1, 'R-01', 'dev', 'Z2', 'precomputed', 0, 0, 0, 1, 1, false, '[[0, 0], [1, 1]]')`,
      '23505',
      'dispatch_alert_id_key',
    ],
    ['등록되지 않은 단말로 작업', "INSERT INTO work (site_id, zone_id, title, device_id, published_by) VALUES ('demo', 'Z1', '유령', 'device-99', '담당자')", '23503', 'work_device_id_fkey'],
    ['시작한 작업을 취소', "UPDATE work SET status = 'cancelled', cancelled_at = now(), cancel_reason = '그냥' WHERE id = 7", '23514', 'work_cancel_before_start'],
    ['사유 없이 취소', "UPDATE work SET status = 'cancelled', cancelled_at = now() WHERE id = 8", '23514', 'work_cancel_before_start'],
    ['시작하지 않은 작업을 종료', "UPDATE work SET status = 'ended', ended_at = now() WHERE id = 8", '23514', 'work_started_before_end'],
    ['종료 시각 없이 종료 상태', "UPDATE work SET status = 'ended' WHERE id = 7", '23514', 'work_ended_at'],
    ['측정값 없는 측정 이상 알림', "INSERT INTO alert (site_id, type, source, status) VALUES ('demo', 'abnormal', 'reading', 'open')", '23514', 'alert_reading_detail'],
    ['쓰러짐을 측정값 출처로', "INSERT INTO alert (site_id, type, source, status) VALUES ('demo', 'fall', 'reading', 'dispatched')", '23514', 'alert_reading_source'],
    ['결과 없이 알림 종료', "UPDATE alert SET status = 'resolved', resolution = NULL, resolved_at = NULL WHERE id = 1", '23514', 'alert_resolved'],
    ['이유 없는 사람 출동 필요', "INSERT INTO alert (site_id, type, source, status) VALUES ('demo', 'fall', 'debug', 'no_robot')", '23514', 'alert_no_robot_reason'],
    ['파일도 주소도 없는 도면', "INSERT INTO drawing (site_id, title, kind, file_name, mime, uploaded_by) VALUES ('demo', 'x', 'other', 'x.pdf', 'application/pdf', '담당자')", '23514', 'drawing_one_source'],
    ['없는 구역의 도면', "INSERT INTO drawing_zone (drawing_id, zone_id) VALUES (1, 'Z9')", '23503', 'drawing_zone_zone_id_fkey'],
    // 0001 비콘
    ['MAC 도 비콘 id 도 없는 헬멧 비콘', "INSERT INTO device (id, site_id, kind, label) VALUES ('helmet-x', 'demo', 'helmet_beacon', '헬멧')", '23514', 'device_identifiable'],
    ['비콘 id 형식이 아님 (대문자)', "UPDATE device SET beacon_id = '9D299FF3-5431-40E6-85D6-4AC08806000E:1:2' WHERE id = 'device-02'", '23514', 'device_beacon_id_check'],
    ['두 단말이 같은 비콘 id', "UPDATE device SET beacon_id = '9d299ff3-5431-40e6-85d6-4ac08806000e:1:1' WHERE id = 'device-02'", '23505', 'device_beacon_id_key'],
    ['MAC 없는 고정 비콘 (수신기만 MAC 없이 된다)', "INSERT INTO anchor (id, kind, zone_id, scan_id, x, y, z, position_source) VALUES ('B-x', 'beacon', 'Z1', 'dev', 0, 0, 0, 'manual')", '23514', 'anchor_beacon_mac'],
    [
      '모르는 구역 출처',
      "INSERT INTO alert (site_id, type, source, zone_id, zone_source, status, robot_unavailable) VALUES ('demo', 'fall', 'debug', 'Z1', 'gps', 'no_robot', '충전 중')",
      '23514',
      'alert_zone_source_check',
    ],
  ];
  for (const [name, sql, code, message] of BLOCKED) it(`막힘: ${name}`, () => blocked(sql, code, message));

  it('막힘: 한 단말에 작업 중 둘 (쓰러짐 구역이 모호해진다)', async () => {
    const [w] = await db.query<{ id: number }>(
      "INSERT INTO work (site_id, zone_id, title, device_id, published_by) VALUES ('demo', 'Z3', '두 번째', 'device-02', '담당자') RETURNING id",
    );
    await blocked(
      `UPDATE work SET status = 'confirmed', confirmed_by = '작업반장', confirmed_at = now() WHERE id = ${w.id}`,
      '23505',
      'work_one_active_per_device',
    );
  });

  it('막힘: TRUNCATE event · confirmation', async () => {
    await blocked('TRUNCATE event', '23514', '기록은 고치거나 지울 수 없어요');
    await blocked('TRUNCATE confirmation', '23514', '기록은 고치거나 지울 수 없어요');
  });

  // ── 통과해야 할 것 ────────────────────────────────────────────
  it('통과: 정상 범위 안 값 · 경계값 (산소 18 은 이상이라 통과)', async () => {
    await db.query(`${C} (9, 2, 5, 18, NULL, '작업반장')`);
    await db.query(`${C} (9, 7, 14, 0, NULL, '작업반장')`);
  });

  it('통과: 사진 파일 없이 이름만 (프론트 목업 호환 · 임시)', async () => {
    await db.query(`${C} (9, 7, 15, NULL, 'lock.jpg', '작업반장')`);
  });

  it('통과: 승인 (미확인 → 공식, 한 번)', async () => {
    await db.query("UPDATE tag SET official = true, verified_by = '원청 안전팀', verified_at = now() WHERE id = 3");
  });

  it('통과: 모든 컬럼을 그대로 실은 UPDATE (ORM 처럼) — 예전 버전에도', async () => {
    for (const id of [6, 1]) {
      const [t] = await db.query<Record<string, unknown>>('SELECT * FROM tag WHERE id = $1', [id]);
      const cols = ['zone_id', 'x', 'y', 'z', 'title', 'substance', 'hazard', 'emergency_note', 'equipment_state', 'official',
        'verified_by', 'verified_at', 'version', 'status', 'superseded_at'];
      await db.query(`UPDATE tag SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => t[c])]);
    }
  });

  it('통과: 취소(시작 전 · 사유) · 종료(작업 중) · 측정 이상 알림 · 사람 출동', async () => {
    await db.query("UPDATE work SET status = 'cancelled', cancelled_by = '담당자', cancelled_at = now(), cancel_reason = '자재 미입고' WHERE id = 8");
    await db.query("UPDATE work SET status = 'ended', ended_by = '작업반장', ended_at = now() WHERE id = 7");
    await db.query(
      `INSERT INTO alert (site_id, type, source, device_id, zone_id, work_id, status, tag_id, check_item_id, reading_value)
       VALUES ('demo', 'abnormal', 'reading', 'device-01', 'Z1', 9, 'open', 7, 14, 3)`,
    );
    await db.query(
      `INSERT INTO alert (site_id, type, source, device_id, zone_id, status, robot_unavailable, human_dispatched_by, human_dispatched_at)
       VALUES ('demo', 'fall', 'sos_button', 'device-01', 'Z1', 'no_robot', '충전 중', '관제', now())`,
    );
  });

  it('통과: 비콘 (0001) — 수신기는 MAC 없이 · 단말 비콘 id 는 씬에서 · 알림 구역 출처', async () => {
    const applied = await db.query<{ name: string }>('SELECT name FROM _migrations ORDER BY name');
    assert.deepEqual(applied.map((m) => m.name), ['0000_init.sql', '0001_beacon.sql']);
    const gw = await db.query("SELECT id, kind, zone_id, mac, x, y FROM anchor WHERE kind = 'gateway' ORDER BY id");
    assert.deepEqual(gw, [
      { id: 'gw-01', kind: 'gateway', zone_id: 'Z1', mac: null, x: 0, y: 1.5 },
      { id: 'gw-02', kind: 'gateway', zone_id: 'Z1', mac: null, x: 2, y: 1.5 },
    ]);
    await db.query(
      `INSERT INTO alert (site_id, type, source, device_id, zone_id, zone_source, status, robot_unavailable)
       VALUES ('demo', 'fall', 'sos_button', 'device-01', 'Z1', 'beacon', 'no_robot', '충전 중')`,
    );
    // 씬에서 두 단말의 비콘 id 를 맞바꿔도 다시 반영된다 (겹침 검사에 걸리지 않게 먼저 비운다)
    const scene = loadScene(DEV_SCENE_DIR);
    const ids = scene.devices.map((d) => d.beaconId);
    const beacons = async () => (await db.query<{ beacon_id: string }>('SELECT beacon_id FROM device ORDER BY id')).map((d) => d.beacon_id);
    await new ConfigSync(db, { ...scene, devices: scene.devices.map((d, i) => ({ ...d, beaconId: ids[1 - i] })) }).sync();
    assert.deepEqual(await beacons(), [ids[1], ids[0]]);
    await new ConfigSync(db, scene).sync();
    assert.deepEqual(await beacons(), ids);
  });

  it('번호 빈칸은 실패한 시도다: 막힌 INSERT 도 작업 번호를 쓴다', async () => {
    const [w] = await db.query<{ code: string }>(
      "INSERT INTO work (site_id, zone_id, title, device_id, published_by) VALUES ('demo', 'Z1', '다음', 'device-01', '담당자') RETURNING code",
    );
    // '등록되지 않은 단말' 이 W-010 을 쓰고 막혔고, '두 번째' 작업이 W-011 → 다음은 W-012 (빈칸은 삭제가 아니다)
    assert.equal(w.code, 'W-012');
  });
});
