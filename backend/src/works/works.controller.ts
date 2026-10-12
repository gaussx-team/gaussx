import { Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BaseUrl } from '../api/base-url.js';
import { CancelBody, CardQuery, ConfirmBody, DeviceQuery, WorkBody, WorkIdBody } from '../api/dto.js';
import { SCENE, type Scene } from '../config/scene.js';
import { WorksService } from './works.service.js';

@ApiTags('작업 · 카드')
@Controller('api')
export class WorksController {
  constructor(
    private readonly works: WorksService,
    @Inject(SCENE) private readonly scene: Scene,
  ) {}

  @Post('work')
  @HttpCode(200)
  @ApiOperation({ summary: '작업 등록 · 전송 (구역 · 단말 · 태그 · 허가서 · 허가 시간). 번호 W-001 은 DB 가 매긴다' })
  create(@Body() body: WorkBody, @BaseUrl() base: string) {
    return this.works.create(body, base);
  }

  @Get('work/:id')
  @ApiOperation({ summary: '작업 등록 상세: 진행 · 확인 결과 · 알림 · 출동 · 기록 · 도면' })
  detail(@Param('id', ParseIntPipe) id: number, @BaseUrl() base: string) {
    return this.works.detail(id, base);
  }

  @Post('work/complete')
  @HttpCode(200)
  @ApiOperation({ summary: '확인 완료 = 작업 시작. 필수 항목을 다 했을 때만, 한 단말에서 작업 중은 하나만' })
  complete(@Body() body: WorkIdBody, @BaseUrl() base: string) {
    return this.works.complete(body.workId, base);
  }

  @Post('work/end')
  @HttpCode(200)
  @ApiOperation({ summary: '작업 종료 (작업 중일 때)' })
  end(@Body() body: WorkIdBody, @BaseUrl() base: string) {
    return this.works.end(body.workId, base);
  }

  @Post('work/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '작업 취소 (시작 전만, 사유 필수)' })
  cancel(@Body() body: CancelBody, @BaseUrl() base: string) {
    return this.works.cancel(body.workId, body.reason ?? '', base);
  }

  @Get('card')
  @ApiOperation({ summary: '작업 카드. ?device= 그 단말의 가장 최근 작업 · ?work= 작업 하나 (관리자 미리보기)' })
  card(@Query() q: CardQuery, @BaseUrl() base: string) {
    return this.works.card({ deviceId: q.device ?? this.scene.devices[0].id, workId: q.work ?? null }, base);
  }

  @Post('card/opened')
  @HttpCode(200)
  @ApiOperation({ summary: '카드 열람 기록 (처음 열 때 상태 → opened)' })
  opened(@Body() body: WorkIdBody, @BaseUrl() base: string) {
    return this.works.opened(body.workId, base);
  }

  @Post('confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: '항목 확인 (되돌리지 않는다). 첫 확인 = 체크인',
    description:
      '측정값이 정상 범위를 벗어나면 저장하지 않고 측정 이상 알림을 관제에 남긴 뒤 400. 사진은 data URL 로 보내면 파일로 저장된다',
  })
  confirm(@Body() body: ConfirmBody, @BaseUrl() base: string) {
    return this.works.confirm(body, base);
  }

  @Get('inbox')
  @ApiOperation({ summary: '단말의 작업 목록: 열린 작업 + 오늘 끝나거나 취소된 작업' })
  inbox(@Query() q: DeviceQuery, @BaseUrl() base: string) {
    return this.works.inbox(q.device ?? this.scene.devices[0].id, base);
  }
}
