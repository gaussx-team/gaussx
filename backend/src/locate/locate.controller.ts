import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CalibrateBody, GatewayBody, GatewaySettingsBody, RadarQuery } from '../api/dto.js';
import { SCENE, type Scene } from '../config/scene.js';
import { type GatewaySettingDto, GatewaySettings } from './gateway-settings.service.js';
import { LocateService } from './locate.service.js';

@ApiTags('비콘 구역')
@Controller('api')
export class LocateController {
  constructor(
    private readonly locate: LocateService,
    private readonly settings: GatewaySettings,
    @Inject(SCENE) private readonly scene: Scene,
  ) {}

  @Post('gateway')
  @HttpCode(200)
  @ApiOperation({
    summary: '수신기 보고 (1초마다): 들린 헬멧 비콘과 RSSI',
    description:
      '응답 = 이번에 들린 단말의 판정 (in · out · unknown) + 이 수신기 기준 레이더. 저장하지 않는다 — 위치 이력은 남기지 않는다',
  })
  report(@Body() body: GatewayBody) {
    const devices = this.locate.ingest(body.gatewayId, body.readings);
    return {
      ok: true,
      gatewayId: body.gatewayId,
      zoneId: this.scene.gateways.find((g) => g.id === body.gatewayId)!.zone,
      devices,
      radar: this.locate.radar(body.gatewayId),
    };
  }

  @Get('radar')
  @ApiOperation({
    summary: '레이더: 이 수신기 기준 헬멧 방향 · 거리 (m, x = 오른쪽 · y = 앞)',
    description: '수신기 한 대만 들으면 거리만, 두 대가 들으면 위치까지. 거리는 RSSI 로 어림잡은 값 (실내 ±50%)',
  })
  radar(@Query() q: RadarQuery) {
    return this.locate.radar(q.gateway);
  }

  @Get('gateways')
  @ApiOperation({
    summary: '수신기 설정 (관리자 화면 · 수신기 배치): 자리 · 구역 · 1m 세기 + 연결 상태',
    description: 'custom = 관리자 화면 · 1m 보정으로 바꾼 값이 있나, defaults = 씬 파일 값',
  })
  gateways() {
    return this.settings.list().map((s) => this.withLive(s));
  }

  @Post('gateway/settings')
  @HttpCode(200)
  @ApiOperation({
    summary: '수신기 설정 바꾸기 · 되돌리기 (관리자 화면)',
    description: '주지 않은 칸은 그대로. .data/gateways.json 에 남아 재시작 · 데모 리셋 뒤에도 쓴다. reset = 씬 값으로',
  })
  async saveSettings(@Body() body: GatewaySettingsBody) {
    const item = body.reset
      ? await this.settings.reset(body.gatewayId)
      : await this.settings.update(body.gatewayId, { zoneId: body.zoneId, x: body.x, y: body.y, ref1mDbm: body.ref1mDbm });
    return this.withLive(item);
  }

  @Post('gateway/calibrate')
  @HttpCode(200)
  @ApiOperation({
    summary: '1m 보정: 비콘을 수신기 1m 앞에 두고 부른다',
    description: '최근 3초 세기를 이 수신기의 1m 세기로 저장한다 (관리자 화면에서도 보인다). reset = 씬 값으로',
  })
  async calibrate(@Body() body: CalibrateBody) {
    if (body.reset) {
      const item = await this.settings.reset(body.gatewayId, ['ref1mDbm']);
      return { gatewayId: item.id, ref1mDbm: item.ref1mDbm, saved: true, reset: true };
    }
    const measured = this.locate.measureRef1m(body.gatewayId, body.beaconId);
    await this.settings.update(body.gatewayId, { ref1mDbm: measured.ref1mDbm });
    return { ...measured, saved: true };
  }

  @Get('locate')
  @ApiOperation({ summary: '현장 보정용: 판정 값 · 단말별 수신기 RSSI 중앙값 · 어림 거리 · 위치 · 등록 안 된 비콘' })
  debug() {
    return this.locate.debug();
  }

  /** 설정 + 지금 연결 상태 */
  private withLive(s: GatewaySettingDto) {
    const live = this.locate.gateways().find((g) => g.id === s.id);
    return { ...s, online: live?.online ?? false, lastReportAt: live?.lastReportAt ?? null };
  }
}
