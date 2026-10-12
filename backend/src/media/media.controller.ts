import { BadRequestException, Body, Controller, HttpCode, Inject, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { BaseUrl } from '../api/base-url.js';
import { DB, type Db } from '../db/db.js';
import { fileUrl } from '../domain/views.js';
import { MAX_DRAWING_BYTES, MediaService } from './media.service.js';

const UPLOAD_KINDS = ['confirm_photo', 'permit_pdf', 'tag_snapshot'] as const;

export class UploadBody {
  @ApiProperty({ enum: UPLOAD_KINDS })
  @IsIn(UPLOAD_KINDS)
  kind: (typeof UPLOAD_KINDS)[number];
}

@ApiTags('파일')
@Controller('api')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Post('media')
  @HttpCode(200)
  @ApiOperation({
    summary: '사진 · 작업허가서 파일 올리기 (multipart, 10MB)',
    description: '응답의 mediaId 를 POST /api/confirm 의 photoMediaId 로. JSON 의 data URL 로 보내도 된다 (photo · permitFile)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'kind'],
      properties: { file: { type: 'string', format: 'binary' }, kind: { type: 'string', enum: [...UPLOAD_KINDS] } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DRAWING_BYTES } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: UploadBody, @BaseUrl() base: string) {
    if (!file) throw new BadRequestException('파일이 없어요 (multipart 필드 이름: file)');
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8'); // multer 는 파일 이름을 latin1 로 읽는다
    const saved = await this.db.tx((q) => this.media.save(q, body.kind, file.buffer, { fileName: name, mime: file.mimetype }));
    return { mediaId: saved.id, url: fileUrl(base, saved.path) };
  }
}
