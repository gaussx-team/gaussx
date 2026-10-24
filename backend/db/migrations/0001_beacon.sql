-- v5.1 (2026-10-18) · 비콘 구역 감지 — 헬멧 비콘(작업자 단말) + 고정 수신기(게이트웨이)
-- 판정은 서버 메모리에서만 한다: 위치 이력은 남기지 않는다 (원칙 4). 알림이 날 때 그 순간의 구역만 alert 에 남는다.

-- 단말이 내는 비콘의 id. 안드로이드 폰은 광고할 때 MAC 이 수시로 바뀌어 MAC 으로 찾을 수 없다
-- → iBeacon 식별자 "uuid:major:minor" (소문자)
ALTER TABLE device ADD COLUMN beacon_id text UNIQUE CHECK (beacon_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{1,5}:[0-9]{1,5}$');
ALTER TABLE device DROP CONSTRAINT device_check;
ALTER TABLE device ADD CONSTRAINT device_identifiable CHECK (kind = 'phone' OR mac IS NOT NULL OR beacon_id IS NOT NULL);

-- 수신기(게이트웨이)는 보고에 실어 오는 id 로 찾는다 → MAC 이 없어도 된다. 고정 비콘은 여전히 MAC 이 필요
ALTER TABLE anchor ALTER COLUMN mac DROP NOT NULL;
ALTER TABLE anchor ADD CONSTRAINT anchor_beacon_mac CHECK (kind = 'gateway' OR mac IS NOT NULL);

-- 알림 구역을 어디서 정했나: 직접 지정 · 비콘 · 작업 중 구역. 이 판 이전 알림은 NULL
ALTER TABLE alert ADD COLUMN zone_source text CHECK (zone_source IN ('request', 'beacon', 'work'));
