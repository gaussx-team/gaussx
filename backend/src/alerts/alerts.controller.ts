import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AlertIdBody, EventBody, ResolveBody, RobotModeBody } from '../api/dto.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import type { RobotMode } from '../domain/rules.js';
import { AlertsService } from './alerts.service.js';

@ApiTags('쓰러짐 · 로봇')
@Controller('api')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly dispatch: DispatchService,
  ) {}

  @Post('event')
  @HttpCode(200)
  @ApiOperation({
    summary: '쓰러짐 (수동 SOS · 자동 감지 · 관제 직접 출동 · 무대 트리거)',
    description:
      '알림과 동시에 로봇이 출발한다. 구역: zoneId → 그 단말의 작업 중 구역 → 불명. 로봇이 못 가면 status = no_robot (사람 출동 필요)',
  })
  event(@Body() body: EventBody) {
    return this.alerts.raiseFall({
      source: body.source ?? 'debug',
      deviceId: body.deviceId ?? null,
      zoneId: body.zoneId ?? null,
      confidence: body.confidence,
      signal: body.signal,
      buffer: body.buffer,
    });
  }

  @Post('alert/ack')
  @HttpCode(200)
  @ApiOperation({ summary: '관제 확인 (기록용 · 출동 조건 아님)' })
  ack(@Body() body: AlertIdBody) {
    return this.alerts.acknowledge(body.alertId);
  }

  @Post('alert/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: '알림 종료: 처리 완료 · 오탐 해제. 가는 중인 로봇은 멈추고 대기 위치로' })
  resolve(@Body() body: ResolveBody) {
    return this.alerts.resolve(body.alertId, body.resolution === 'false_alarm' ? 'false_alarm' : 'handled');
  }

  @Post('alert/human')
  @HttpCode(200)
  @ApiOperation({ summary: '로봇이 못 갈 때 안전관리자 출동 지시' })
  human(@Body() body: AlertIdBody) {
    return this.alerts.dispatchHuman(body.alertId);
  }

  @Post('robot/mode')
  @HttpCode(200)
  @ApiOperation({ summary: '로봇 운영 상태 (출동 대기 · 충전 · 점검 · 연결 끊김). 대기가 아니면 쓰러짐은 사람 출동 필요로' })
  mode(@Body() body: RobotModeBody) {
    return this.dispatch.setMode(body.mode as RobotMode);
  }
}
