-- GaussX 데모 스키마 v5 (2026-10-12) — 프론트 계약(frontend/src/lib/types.ts, SPEC v2 §8) 반영
-- 원본은 이 파일. 설명: docs/ERD.md. 데모 회차(세션)마다 스키마 하나에 이 파일을 넣는다 (서버가 한다).
-- 원칙: 화면만 믿지 않고 DB 에서도 막는다 · 기록(확인 · 이벤트)은 고치거나 지우지 않는다 · 위치 이력은 남기지 않는다.
-- 메시지는 화면에 그대로 나가므로 화면 말투(해요체)로 쓴다.

-- ── 공통 ────────────────────────────────────────────────────────
-- 현장. 여러 현장 대비 (SPEC v2 §8: 모든 주요 테이블에 site_id)
CREATE TABLE site (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3D 스캔 1개 = 좌표계 1개
CREATE TABLE scan (
  id                text PRIMARY KEY,
  site_id           text NOT NULL REFERENCES site (id),
  scene_dir         text NOT NULL,
  captured_at       timestamptz,
  code_version      text,
  origin_marker_id  integer,
  is_active         boolean NOT NULL DEFAULT false,
  imported_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scan_one_active ON scan (site_id) WHERE is_active;

CREATE TABLE zone (
  id        text PRIMARY KEY,
  site_id   text NOT NULL REFERENCES site (id),
  name      text NOT NULL,
  color     text,
  sort      integer NOT NULL DEFAULT 0,
  kind      text NOT NULL DEFAULT 'area'
              CHECK (kind IN ('area', 'danger', 'restricted', 'confined_space')),
  scan_id   text REFERENCES scan (id),
  -- 바닥 다각형 [[x, y], ...] (m, 그 스캔의 좌표계). 지금은 화면의 사각형(rect) 4점 — 잠정: 3D 연동 때 재결정
  polygon   jsonb,
  z_min     double precision,
  z_max     double precision,
  UNIQUE (site_id, name),
  CONSTRAINT zone_polygon_needs_scan CHECK (polygon IS NULL OR (scan_id IS NOT NULL AND jsonb_typeof(polygon) = 'array')),
  CHECK (z_min IS NULL OR z_max IS NULL OR z_min < z_max)
);

-- 위치를 재는 고정 장비 (비콘 · 게이트웨이). 데모 범위 밖 — 로드맵(실시간 위치)용으로 남겨 둔다
CREATE TABLE anchor (
  id               text PRIMARY KEY,
  kind             text NOT NULL DEFAULT 'beacon' CHECK (kind IN ('beacon', 'gateway')),
  zone_id          text REFERENCES zone (id),
  mac              text NOT NULL UNIQUE,
  marker_id        integer,
  scan_id          text NOT NULL REFERENCES scan (id),
  x                double precision NOT NULL,
  y                double precision NOT NULL,
  z                double precision NOT NULL,
  position_source  text NOT NULL CHECK (position_source IN ('marker', 'manual'))
);

-- 작업자 단말. 데모 = 작업반장 휴대폰 'device-01' (로그인 없음 → 단말로 작업을 받는다)
CREATE TABLE device (
  id             text PRIMARY KEY,
  site_id        text NOT NULL REFERENCES site (id),
  kind           text NOT NULL DEFAULT 'phone'
                   CHECK (kind IN ('phone', 'helmet_beacon', 'uwb_tag')),
  mac            text UNIQUE,
  label          text NOT NULL,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'phone' OR mac IS NOT NULL)
);

CREATE TABLE robot (
  id            text PRIMARY KEY,
  site_id       text NOT NULL REFERENCES site (id),
  scan_id       text NOT NULL REFERENCES scan (id),
  home_x        double precision NOT NULL,
  home_y        double precision NOT NULL,
  home_yaw_rad  double precision NOT NULL,
  pose_x        double precision NOT NULL,
  pose_y        double precision NOT NULL,
  pose_yaw_rad  double precision NOT NULL,
  pose_at       timestamptz NOT NULL DEFAULT now(),
  -- 운영 상태: ready 가 아니면 쓰러짐 알림이 '사람 출동 필요'(no_robot)로 간다
  mode          text NOT NULL DEFAULT 'ready' CHECK (mode IN ('ready', 'charging', 'maintenance', 'offline')),
  battery       integer NOT NULL DEFAULT 100 CHECK (battery BETWEEN 0 AND 100)
);

-- 파일 (사진 · 허가서 · 도면). 파일은 FILES_DIR, 여기는 경로와 해시(증빙)
CREATE TABLE media (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL
                 CHECK (kind IN ('tag_photo', 'tag_snapshot', 'confirm_photo', 'permit_pdf', 'drawing')),
  path         text NOT NULL UNIQUE,
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_name    text,
  mime         text,
  width        integer,
  height       integer,
  source_view  text,
  u            double precision,
  v            double precision,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── A 작업 카드 ─────────────────────────────────────────────────
-- 위험 태그. 고치지 않고 새 버전을 만든다 (예전 버전은 superseded 로 남고, 이미 보낸 작업은 예전 버전을 가리킨다)
CREATE TABLE tag (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id            text NOT NULL REFERENCES site (id),
  zone_id            text NOT NULL REFERENCES zone (id),
  scan_id            text NOT NULL REFERENCES scan (id),
  x                  double precision NOT NULL,
  y                  double precision NOT NULL,
  z                  double precision,                    -- 3D 연동 전에는 NULL (바닥 좌표만)
  title              text NOT NULL,                       -- 설비 번호 포함 ('배관 P-203')
  substance          text,
  hazard             text NOT NULL,                       -- 카드에 크게 나오는 한 줄
  emergency_note     text,                                -- 사고 시 구조자용 주의
  equipment_state    text NOT NULL CHECK (equipment_state IN
                       ('running', 'stopped', 'valve_open', 'valve_closed', 'deteriorated')),
  official           boolean NOT NULL DEFAULT false,      -- 공식확인 / 미확인 (승인하면 true, 되돌리지 않는다)
  verified_by        text,
  verified_at        timestamptz,
  valid_until        timestamptz,
  photo_media_id     integer UNIQUE REFERENCES media (id),
  snapshot_media_id  integer UNIQUE REFERENCES media (id),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  supersedes_tag_id  integer UNIQUE REFERENCES tag (id), -- 이 버전이 대체한 이전 버전 (API: replacesId)
  superseded_at      timestamptz,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tag_superseded_at CHECK ((status = 'superseded') = (superseded_at IS NOT NULL)),
  CONSTRAINT tag_version_chain CHECK ((version = 1) = (supersedes_tag_id IS NULL)),
  CONSTRAINT tag_official_verified CHECK (NOT official OR verified_at IS NOT NULL)
);

CREATE TABLE check_item (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tag_id               integer NOT NULL REFERENCES tag (id),
  seq                  integer NOT NULL,
  item                 text NOT NULL,
  needs                text NOT NULL DEFAULT 'none' CHECK (needs IN ('none', 'value', 'photo')),
  unit                 text,
  required             boolean NOT NULL DEFAULT true,     -- 필수 항목을 다 해야 "작업 시작"
  -- 측정값 정상 범위: 최소는 '이상', 최대는 '이하' 또는 '미만'(range_max_exclusive) — 법정 기준이 대부분 "~미만"
  range_min            double precision,
  range_max            double precision,
  range_max_exclusive  boolean NOT NULL DEFAULT false,
  UNIQUE (tag_id, seq),
  UNIQUE (tag_id, id),
  CHECK (range_min IS NULL OR range_max IS NULL OR range_min <= range_max),
  CONSTRAINT check_item_range_for_value CHECK (needs = 'value' OR (range_min IS NULL AND range_max IS NULL))
);

CREATE SEQUENCE work_code_seq;
-- 작업 (SPEC v2: '작업 지시' → '작업 등록'). 한 단말에서 '작업 중'(confirmed)은 1건만
CREATE TABLE work (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code             text NOT NULL UNIQUE
                     DEFAULT ('W-' || to_char(nextval('work_code_seq'), 'FM999999000')),
  site_id          text NOT NULL REFERENCES site (id),
  zone_id          text NOT NULL REFERENCES zone (id),
  title            text NOT NULL,
  device_id        text NOT NULL REFERENCES device (id),
  status           text NOT NULL DEFAULT 'published'
                     CHECK (status IN ('published', 'opened', 'confirmed', 'ended', 'cancelled')),
  published_by     text NOT NULL,
  published_at     timestamptz NOT NULL DEFAULT now(),
  opened_at        timestamptz,                           -- 카드 첫 열람
  checked_in_at    timestamptz,                           -- 첫 확인 = 체크인
  confirmed_by     text,
  confirmed_at     timestamptz,                           -- 확인 완료 = 작업 시작
  ended_by         text,
  ended_at         timestamptz,
  cancelled_by     text,
  cancelled_at     timestamptz,                           -- 작업 시작 전에만 취소 (사유 필수)
  cancel_reason    text,
  permit_name      text,                                  -- 작업허가서 파일 이름
  permit_media_id  integer UNIQUE REFERENCES media (id),  -- 작업허가서 파일 (올렸을 때)
  permit_url       text,                                  -- 또는 링크
  permit_start     timestamptz,                           -- 허가 시간 (넘으면 화면이 경고)
  permit_end       timestamptz,
  CONSTRAINT work_ended_at CHECK ((status = 'ended') = (ended_at IS NOT NULL)),
  CONSTRAINT work_cancelled_at CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  -- 사유가 NULL 이면 length() 도 NULL 이 되어 CHECK 가 통과해 버린다 → IS NOT NULL 을 따로 적는다
  CONSTRAINT work_cancel_before_start CHECK (status <> 'cancelled' OR (confirmed_at IS NULL AND cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')),
  CONSTRAINT work_started_before_end CHECK (status NOT IN ('confirmed', 'ended') OR confirmed_at IS NOT NULL),
  CONSTRAINT work_permit_window CHECK (permit_start IS NULL OR permit_end IS NULL OR permit_start < permit_end)
);
-- 쓰러짐 알림의 구역 = 그 단말의 작업 중 구역. 작업 중이 둘이면 어느 구역인지 알 수 없다
CREATE UNIQUE INDEX work_one_active_per_device ON work (device_id) WHERE status = 'confirmed';

CREATE TABLE work_tag (
  work_id  integer NOT NULL REFERENCES work (id),
  tag_id   integer NOT NULL REFERENCES tag (id),
  seq      integer NOT NULL,
  PRIMARY KEY (work_id, tag_id)
);

-- 작업반장의 확인 (추가 전용). 되돌리지 않는다
CREATE TABLE confirmation (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_id         integer NOT NULL,
  tag_id          integer NOT NULL,
  check_item_id   integer NOT NULL,
  value           double precision,
  photo_media_id  integer UNIQUE REFERENCES media (id),
  photo_name      text,                                   -- 사진 파일 이름 (파일 없이 이름만 온 경우: 목업 호환 · 임시)
  device_id       text REFERENCES device (id),
  confirmed_by    text NOT NULL,
  confirmed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id, check_item_id),
  FOREIGN KEY (work_id, tag_id)       REFERENCES work_tag (work_id, tag_id),
  FOREIGN KEY (tag_id, check_item_id) REFERENCES check_item (tag_id, id)
);

-- ── C 쓰러짐 · 측정 이상 · 로봇 출동 ────────────────────────────
CREATE TABLE alert (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id              text NOT NULL REFERENCES site (id),
  type                 text NOT NULL CHECK (type IN ('fall', 'abnormal')),          -- 쓰러짐 / 측정 이상
  -- 수동 SOS · 자동 감지 · 관제 직접 출동 · 무대 트리거 · 측정값 (10/10 결정)
  source               text NOT NULL CHECK (source IN ('sos_button', 'accel', 'operator', 'debug', 'reading')),
  device_id            text REFERENCES device (id),
  zone_id              text REFERENCES zone (id),          -- 직접 지정 → 그 단말의 작업 중 구역 → 불명(NULL)
  work_id              integer REFERENCES work (id),
  -- dispatched 로봇 출동 · arrived 도착 · no_robot 사람 출동 필요 · open 출동 없는 알림(측정 이상) · resolved
  status               text NOT NULL CHECK (status IN ('dispatched', 'arrived', 'no_robot', 'open', 'resolved')),
  confidence           double precision CHECK (confidence BETWEEN 0 AND 1),
  signal               jsonb,
  buffer               jsonb,
  raised_at            timestamptz NOT NULL DEFAULT now(),
  robot_unavailable    text,                                -- 로봇이 못 간 이유 ('충전 중', '구역 불명' …)
  human_dispatched_by  text,
  human_dispatched_at  timestamptz,                         -- 관제가 안전관리자 출동을 지시한 시각
  acknowledged_by      text,
  acknowledged_at      timestamptz,                         -- 관제 확인 (출동 조건이 아니다, 기록용)
  resolution           text CHECK (resolution IN ('handled', 'false_alarm')),
  resolved_by          text,
  resolved_at          timestamptz,
  -- 측정 이상: 정상 범위를 벗어난 값 (확인으로는 저장되지 않는다)
  tag_id               integer,
  check_item_id        integer,
  reading_value        double precision,
  rechecked_value      double precision,                    -- 이후 정상값으로 다시 확인된 값
  rechecked_at         timestamptz,
  FOREIGN KEY (tag_id, check_item_id) REFERENCES check_item (tag_id, id),
  CONSTRAINT alert_reading_source CHECK ((type = 'abnormal') = (source = 'reading')),
  CONSTRAINT alert_reading_detail CHECK (type = 'fall' OR
    (work_id IS NOT NULL AND tag_id IS NOT NULL AND check_item_id IS NOT NULL AND reading_value IS NOT NULL)),
  CONSTRAINT alert_status_by_type CHECK (CASE type WHEN 'fall' THEN status <> 'open' ELSE status IN ('open', 'resolved') END),
  CONSTRAINT alert_resolved CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND resolution IS NOT NULL)),
  CONSTRAINT alert_no_robot_reason CHECK (status <> 'no_robot' OR robot_unavailable IS NOT NULL)
);

-- 로봇 출동. 데모는 알림 1건에 출동 최대 1번
CREATE TABLE dispatch (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id       integer NOT NULL UNIQUE REFERENCES alert (id),
  robot_id       text NOT NULL REFERENCES robot (id),
  scan_id        text NOT NULL REFERENCES scan (id),
  goal_zone_id   text NOT NULL REFERENCES zone (id),
  computed       text NOT NULL CHECK (computed IN ('live', 'precomputed')),
  start_x        double precision NOT NULL,
  start_y        double precision NOT NULL,
  start_yaw_rad  double precision NOT NULL,
  goal_x         double precision NOT NULL,
  goal_y         double precision NOT NULL,
  snapped        boolean NOT NULL,
  path           jsonb NOT NULL,                            -- 웨이포인트 [[x, y], ...]
  trajectory     jsonb,                                     -- [[t, x, y, yaw], ...]
  -- cancelled: 알림이 처리 완료 · 오탐 해제돼 중간에 멈춤
  status         text NOT NULL DEFAULT 'planning'
                   CHECK (status IN ('planning', 'moving', 'arrived', 'failed', 'cancelled')),
  reached        boolean,
  duration_s     double precision,
  distance_m     double precision,
  planned_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  ended_at       timestamptz,
  CONSTRAINT dispatch_ended_at CHECK ((status IN ('arrived', 'failed', 'cancelled')) = (ended_at IS NOT NULL))
);

-- ── 도면 ────────────────────────────────────────────────────────
-- CAD 원본(DWG)은 브라우저가 못 그려서 내려받기만. 보기용은 PDF · SVG · PNG
CREATE TABLE drawing (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id        text NOT NULL REFERENCES site (id),
  title          text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('floor', 'pid', 'electrical', 'other')),
  dwg_no         text,
  revision       text NOT NULL DEFAULT 'REV.0',
  equipment      text[] NOT NULL DEFAULT '{}',              -- 관련 설비 번호. 태그 제목에 있으면 연결
  file_name      text NOT NULL,
  mime           text NOT NULL,
  media_id       integer UNIQUE REFERENCES media (id),      -- 올린 파일
  url            text,                                      -- 또는 프론트 정적 파일 (/drawings/…)
  cad            boolean NOT NULL DEFAULT false,
  maps_to_floor  boolean NOT NULL DEFAULT false,            -- 평면도 좌표와 같아 태그를 겹쳐 그릴 수 있음
  note           text,
  uploaded_by    text NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drawing_one_source CHECK ((media_id IS NULL) <> (url IS NULL))
);

CREATE TABLE drawing_zone (
  drawing_id  integer NOT NULL REFERENCES drawing (id),
  zone_id     text NOT NULL REFERENCES zone (id),
  PRIMARY KEY (drawing_id, zone_id)
);

-- ── 기록 ────────────────────────────────────────────────────────
-- 이력 화면이 이 테이블을 그대로 보여준다. 위치 이동 유형(zone.changed)은 없다
CREATE TABLE event (
  seq          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  site_id      text NOT NULL REFERENCES site (id),
  type         text NOT NULL CHECK (type IN (
                 'tag.created', 'tag.revised', 'tag.verified',
                 'work.published', 'card.opened', 'work.checked_in', 'check.confirmed', 'check.rejected',
                 'work.confirmed', 'work.ended', 'work.cancelled',
                 'alert.raised', 'alert.abnormal', 'alert.acknowledged', 'alert.resolved',
                 'dispatch.started', 'dispatch.arrived', 'dispatch.failed', 'dispatch.unavailable', 'dispatch.human',
                 'robot.mode', 'drawing.uploaded', 'session.reset')),
  actor        text NOT NULL,
  text         text NOT NULL,                               -- 화면에 보일 한 줄
  tag_id       integer REFERENCES tag (id),
  work_id      integer REFERENCES work (id),
  alert_id     integer REFERENCES alert (id),
  dispatch_id  integer REFERENCES dispatch (id),
  drawing_id   integer REFERENCES drawing (id),
  device_id    text REFERENCES device (id),
  payload      jsonb
);
CREATE INDEX event_at ON event (at);

-- (여유) 스캔 중 RSSI — 실시간 위치(로드맵)의 지도
CREATE TABLE rssi_fingerprint (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scan_id    text NOT NULL REFERENCES scan (id),
  frame      text NOT NULL,
  t_s        double precision NOT NULL,
  x          double precision NOT NULL,
  y          double precision NOT NULL,
  z          double precision NOT NULL,
  anchor_id  text NOT NULL REFERENCES anchor (id),
  rssi_dbm   integer NOT NULL
);

-- ── 규칙 (PL/pgSQL). search_path 를 만든 때로 고정: 세션 스키마마다 자기 테이블을 본다 ─────
CREATE FUNCTION confirmation_needs() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  ci check_item%ROWTYPE;
BEGIN
  SELECT * INTO ci FROM check_item WHERE id = NEW.check_item_id;
  IF ci.needs = 'value' THEN
    IF NEW.value IS NULL THEN
      RAISE EXCEPTION '값이 필요한 항목이에요' USING ERRCODE = 'check_violation';
    END IF;
    IF (ci.range_min IS NOT NULL AND NEW.value < ci.range_min)
       OR (ci.range_max IS NOT NULL AND (NEW.value > ci.range_max
                                         OR (ci.range_max_exclusive AND NEW.value >= ci.range_max))) THEN
      RAISE EXCEPTION '정상 범위를 벗어난 값은 확인으로 저장하지 않아요' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF ci.needs = 'photo' AND NEW.photo_media_id IS NULL AND NEW.photo_name IS NULL THEN
    RAISE EXCEPTION '사진이 필요한 항목이에요' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER confirmation_needs BEFORE INSERT ON confirmation
  FOR EACH ROW EXECUTE FUNCTION confirmation_needs();

-- 태그: 내용은 바꾸지 않고 새 버전을 만든다. 바뀔 수 있는 것: 상태(대체됨) · 승인(미확인 → 공식, 한 번) · 사진
CREATE FUNCTION tag_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF OLD.status = 'superseded' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION '대체된 예전 버전은 바꿀 수 없어요' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.site_id, NEW.zone_id, NEW.scan_id, NEW.x, NEW.y, NEW.z, NEW.title, NEW.substance, NEW.hazard,
      NEW.emergency_note, NEW.equipment_state, NEW.valid_until, NEW.version, NEW.supersedes_tag_id,
      NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.site_id, OLD.zone_id, OLD.scan_id, OLD.x, OLD.y, OLD.z, OLD.title, OLD.substance, OLD.hazard,
      OLD.emergency_note, OLD.equipment_state, OLD.valid_until, OLD.version, OLD.supersedes_tag_id,
      OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION '태그는 고치지 않고 새 버전을 만들어요' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.official AND (NEW.official, NEW.verified_by, NEW.verified_at)
                      IS DISTINCT FROM (OLD.official, OLD.verified_by, OLD.verified_at) THEN
    RAISE EXCEPTION '승인된 태그의 확인 정보는 바꿀 수 없어요' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT NEW.official AND (NEW.verified_by, NEW.verified_at) IS DISTINCT FROM (OLD.verified_by, OLD.verified_at) THEN
    RAISE EXCEPTION '승인하지 않고 확인 정보만 바꿀 수 없어요' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tag_guard BEFORE UPDATE ON tag
  FOR EACH ROW EXECUTE FUNCTION tag_guard();

-- 확인 기록 · 이벤트 · 작업에 묶인 태그: 추가만. UPDATE · DELETE · TRUNCATE 모두 막는다
CREATE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  RAISE EXCEPTION '%: 기록은 고치거나 지울 수 없어요', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER confirmation_append_only BEFORE UPDATE OR DELETE ON confirmation
  FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER confirmation_no_truncate BEFORE TRUNCATE ON confirmation
  FOR EACH STATEMENT EXECUTE FUNCTION append_only();
CREATE TRIGGER event_append_only BEFORE UPDATE OR DELETE ON event
  FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER event_no_truncate BEFORE TRUNCATE ON event
  FOR EACH STATEMENT EXECUTE FUNCTION append_only();
CREATE TRIGGER work_tag_append_only BEFORE UPDATE OR DELETE ON work_tag
  FOR EACH ROW EXECUTE FUNCTION append_only();
