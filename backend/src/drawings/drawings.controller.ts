import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BaseUrl } from '../api/base-url.js';
import { DrawingBody, IdQuery } from '../api/dto.js';
import { DrawingsService } from './drawings.service.js';

@ApiTags('도면')
@Controller('api')
export class DrawingsController {
  constructor(private readonly drawings: DrawingsService) {}

  @Get('drawings')
  @ApiOperation({ summary: '도면 목록 (평면도 · P&ID · 단선도)' })
  list(@BaseUrl() base: string) {
    return this.drawings.list(base);
  }

  @Post('drawing')
  @HttpCode(200)
  @ApiOperation({ summary: '도면 등록 (파일은 base64, 20MB 까지). DWG · DXF 는 내려받기만' })
  create(@Body() body: DrawingBody, @BaseUrl() base: string) {
    return this.drawings.create(body, base);
  }

  @Get('drawing/file')
  @ApiOperation({ summary: '올린 도면 파일 (CAD 원본은 내려받기)' })
  async file(@Query() q: IdQuery, @Res() res: Response) {
    const f = await this.drawings.file(q.id);
    const disposition = f.cad ? 'attachment' : 'inline';
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
    res.send(f.data);
  }
}
