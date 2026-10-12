import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * 요청이 들어온 백엔드 주소 ('http://192.168.0.7:3001').
 * 프론트는 다른 주소(3000)에서 돌기 때문에, 백엔드가 주는 파일 주소(사진 · 도면)는 절대 주소여야 한다.
 */
export const BaseUrl = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
});
