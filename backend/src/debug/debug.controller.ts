import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionService } from '../db/session.service.js';
import { DispatchService } from '../dispatch/dispatch.service.js';

@ApiTags('시연 · 회차')
@Controller('api/debug')
export class DebugController {
  constructor(
    private readonly sessions: SessionService,
    private readonly dispatch: DispatchService,
  ) {}

  @Post('reset')
  @HttpCode(200)
  @ApiOperation({
    summary: '데모 리셋 = 새 회차',
    description:
      '기록은 지우지 않는다: 새 스키마에 새 회차를 만들고(데모 데이터 포함) 그쪽으로 옮긴다. 지난 회차는 자기 스키마에 그대로 남는다',
  })
  async reset() {
    this.dispatch.cancelActive();
    const session = await this.sessions.start('데모 리셋');
    return { ok: true, session };
  }

  @Get('sessions')
  @ApiOperation({ summary: '회차 목록 (최신 순). 지금 회차가 맨 위' })
  async list() {
    return { current: this.sessions.current, sessions: await this.sessions.list() };
  }
}
