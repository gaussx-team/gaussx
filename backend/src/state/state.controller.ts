import { Controller, Get, Inject, Query, Redirect } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BaseUrl } from '../api/base-url.js';
import { HistoryQuery } from '../api/dto.js';
import { ComputeClient } from '../compute/compute.client.js';
import { SCENE, type Scene } from '../config/scene.js';
import { DB, type Db } from '../db/db.js';
import type { EventCategory } from '../domain/rules.js';
import { VERSION } from '../version.js';
import { StateService } from './state.service.js';

const CATEGORIES: EventCategory[] = ['work', 'check', 'alert', 'robot', 'tag', 'system'];

@ApiTags('상태 · 이력')
@Controller()
export class StateController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SCENE) private readonly scene: Scene,
    private readonly state: StateService,
    private readonly compute: ComputeClient,
  ) {}

  @Get()
  @Redirect('/docs', 302)
  @ApiExcludeEndpoint()
  root() {}

  @Get('api/state')
  @ApiOperation({ summary: '대시보드 · 관제 · 시연 폴링: 구역 색 · 작업 · 태그 · 알림 · 마지막 출동 · 로봇 · 오늘 타임라인' })
  getState(@BaseUrl() base: string) {
    return this.state.state(base);
  }

  @Get('api/history')
  @ApiOperation({ summary: '이력: ?day=YYYY-MM-DD|today|all &cat=work,alert &zone=Z1 &work=3 &q=검색어 (최신 순)' })
  history(@Query() q: HistoryQuery) {
    return this.state.history({
      day: q.day,
      categories: (q.cat ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter((c): c is EventCategory => (CATEGORIES as string[]).includes(c)),
      zoneId: q.zone,
      workId: q.work ?? null,
      q: q.q,
    });
  }

  @Get('api/devices')
  @ApiOperation({ summary: '작업자 단말 목록 (작업반장 휴대폰)' })
  devices() {
    return this.scene.devices.map((d) => ({ id: d.id, label: d.label, kind: d.kind, beaconId: d.beaconId }));
  }

  @Get('api/config')
  @ApiOperation({ summary: '현장 · 구역 · 단말 · 로봇 대기 위치 (화면이 시작할 때 한 번)' })
  config() {
    const h = this.scene.robot.home;
    return {
      version: VERSION,
      session: this.db.schema,
      site: this.scene.site,
      scan: { id: this.scene.scan.id, capturedAt: this.scene.scan.capturedAt },
      zones: this.scene.zones.map((z) => ({ id: z.id, name: z.name, color: z.color, rect: z.rect })),
      devices: this.scene.devices.map((d) => ({ id: d.id, label: d.label, kind: d.kind, beaconId: d.beaconId })),
      gateways: this.scene.gateways,
      locate: this.scene.locate,
      robot: { id: this.scene.robot.id, home: [h.x, h.y], yaw: h.yaw },
      precomputedRoutes: this.scene.routes?.routes.length ?? 0,
    };
  }

  @Get('api/health')
  @ApiOperation({ summary: '서버 · DB · 회차 · 계산 서비스 상태와 코드 버전' })
  health() {
    return { ok: true, version: VERSION, db: this.db.kind, session: this.db.schema, compute: this.compute.current() };
  }
}
