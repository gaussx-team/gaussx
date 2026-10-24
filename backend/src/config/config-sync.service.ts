import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, type Db, json } from '../db/db.js';
import { SCENE, type Scene } from './scene.js';

/**
 * 설정성 테이블(site · scan · zone · anchor · device · robot)을 씬 파일에서 다시 덮어쓴다.
 * 서버가 켜질 때와 새 회차를 만들 때. 기록성 테이블(tag 이하)은 건드리지 않는다.
 */
@Injectable()
export class ConfigSync {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SCENE) private readonly scene: Scene,
  ) {}

  async sync(): Promise<void> {
    const s = this.scene;
    await this.db.tx(async (q) => {
      await q.query(
        'INSERT INTO site (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
        [s.site.id, s.site.name],
      );

      // 현장당 활성 스캔은 하나 (부분 유일 인덱스 scan_one_active): 다른 스캔을 먼저 내린다
      await q.query('UPDATE scan SET is_active = false WHERE site_id = $1 AND id <> $2 AND is_active', [s.site.id, s.scan.id]);
      await q.query(
        `INSERT INTO scan (id, site_id, scene_dir, captured_at, origin_marker_id, is_active)
         VALUES ($1, $2, $3, $4::timestamptz, $5, true)
         ON CONFLICT (id) DO UPDATE SET site_id = EXCLUDED.site_id, scene_dir = EXCLUDED.scene_dir,
           captured_at = EXCLUDED.captured_at, origin_marker_id = EXCLUDED.origin_marker_id, is_active = true`,
        [s.scan.id, s.site.id, s.dir, s.scan.capturedAt, s.scan.originMarkerId],
      );

      for (const z of s.zones) {
        // 화면의 사각형 → 바닥 다각형 4점 (잠정: 3D 연동 때 실제 다각형으로)
        const polygon = z.rect
          ? [[z.rect[0], z.rect[1]], [z.rect[0] + z.rect[2], z.rect[1]], [z.rect[0] + z.rect[2], z.rect[1] + z.rect[3]], [z.rect[0], z.rect[1] + z.rect[3]]]
          : null;
        await q.query(
          `INSERT INTO zone (id, site_id, name, color, sort, scan_id, polygon) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (id) DO UPDATE SET site_id = EXCLUDED.site_id, name = EXCLUDED.name, color = EXCLUDED.color,
             sort = EXCLUDED.sort, scan_id = EXCLUDED.scan_id, polygon = EXCLUDED.polygon`,
          [z.id, s.site.id, z.name, z.color, z.sort, polygon ? s.scan.id : null, json(polygon)],
        );
      }

      for (const a of s.anchors) {
        await q.query(
          `INSERT INTO anchor (id, kind, zone_id, mac, marker_id, scan_id, x, y, z, position_source)
           VALUES ($1, 'beacon', $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, mac = EXCLUDED.mac, marker_id = EXCLUDED.marker_id,
             scan_id = EXCLUDED.scan_id, x = EXCLUDED.x, y = EXCLUDED.y, z = EXCLUDED.z, position_source = EXCLUDED.position_source`,
          [a.id, a.zone, a.mac, a.marker, s.scan.id, a.world[0], a.world[1], a.world[2], a.source],
        );
      }

      // 비콘 id 를 단말끼리 바꿔 적어도 유일 제약에 걸리지 않게 먼저 비운다 (설정 파일이 원본)
      await q.query('UPDATE device SET beacon_id = NULL WHERE beacon_id IS NOT NULL');
      for (const d of s.devices) {
        await q.query(
          `INSERT INTO device (id, site_id, kind, mac, label, beacon_id) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET site_id = EXCLUDED.site_id, kind = EXCLUDED.kind, mac = EXCLUDED.mac,
             label = EXCLUDED.label, beacon_id = EXCLUDED.beacon_id`,
          [d.id, s.site.id, d.kind, d.mac, d.label, d.beaconId],
        );
      }

      // 수신기(게이트웨이) = 앵커. 보고에 실어 오는 id 로 찾으므로 MAC 은 없다
      for (const g of s.gateways) {
        await q.query(
          `INSERT INTO anchor (id, kind, zone_id, mac, marker_id, scan_id, x, y, z, position_source)
           VALUES ($1, 'gateway', $2, NULL, NULL, $3, $4, $5, $6, 'manual')
           ON CONFLICT (id) DO UPDATE SET kind = 'gateway', zone_id = EXCLUDED.zone_id, mac = NULL, scan_id = EXCLUDED.scan_id,
             x = EXCLUDED.x, y = EXCLUDED.y, z = EXCLUDED.z, position_source = 'manual'`,
          [g.id, g.zone, s.scan.id, g.world[0], g.world[1], g.world[2]],
        );
      }

      // 로봇의 현재 자세 · 운영 상태 · 배터리는 처음 만들 때만. 재시작해도 마지막 값이 남는다
      const h = s.robot.home;
      await q.query(
        `INSERT INTO robot (id, site_id, scan_id, home_x, home_y, home_yaw_rad, pose_x, pose_y, pose_yaw_rad, battery)
         VALUES ($1, $2, $3, $4, $5, $6, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET site_id = EXCLUDED.site_id, scan_id = EXCLUDED.scan_id,
           home_x = EXCLUDED.home_x, home_y = EXCLUDED.home_y, home_yaw_rad = EXCLUDED.home_yaw_rad`,
        [s.robot.id, s.site.id, s.scan.id, h.x, h.y, h.yaw, s.robot.battery],
      );
    });
    new Logger('Config').log(
      `설정 반영 (${this.db.schema}): 현장 ${s.site.id} · 스캔 ${s.scan.id} · 구역 ${s.zones.length} · 단말 ${s.devices.length} · 수신기 ${s.gateways.length}`,
    );
  }
}
