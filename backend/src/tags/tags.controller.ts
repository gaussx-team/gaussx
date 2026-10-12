import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TagBody, TagIdBody, TagReviseBody } from '../api/dto.js';
import { TagsService } from './tags.service.js';

@ApiTags('위험 태그')
@Controller('api')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get('tags')
  @ApiOperation({ summary: '태그 화면: 현재 버전 · 예전 버전 · 작업별로 쓴 버전' })
  list() {
    return this.tags.list();
  }

  @Post('tag')
  @HttpCode(200)
  @ApiOperation({ summary: '태그 만들기 (구역 · 바닥 좌표 · 5개 항목 · 작업 전 확인 항목)' })
  create(@Body() body: TagBody) {
    return this.tags.create(body);
  }

  @Post('tag/revise')
  @HttpCode(200)
  @ApiOperation({ summary: '태그 수정 = 새 버전 (예전 버전은 보관, 이미 보낸 작업은 예전 버전 유지)' })
  revise(@Body() body: TagReviseBody) {
    return this.tags.revise(body.tagId, body.patch);
  }

  @Post('tag/verify')
  @HttpCode(200)
  @ApiOperation({ summary: '승인: 미확인 → 공식 (되돌리지 않는다)' })
  verify(@Body() body: TagIdBody) {
    return this.tags.verify(body.tagId);
  }
}
