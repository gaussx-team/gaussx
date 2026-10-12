import { type ArgumentsHost, BadRequestException, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

interface PgError {
  code: string;
  message: string;
  constraint?: string;
  column?: string;
}

/** DB 드라이버 오류인가 (pg · PGlite 모두 SQLSTATE 를 code 에 담는다) */
export function asPgError(e: unknown): PgError | null {
  const err = e as Partial<PgError> | null;
  return err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) && typeof err.message === 'string'
    ? (err as PgError)
    : null;
}

// 제약 이름 → 화면에 그대로 나갈 말 (프론트 목업과 같은 말투). 트리거가 막은 쓰기는 이미 한국어 메시지를 가지고 온다
const BY_CONSTRAINT: Record<string, string> = {
  confirmation_work_id_check_item_id_key: '이미 확인한 항목이에요 (수정 불가)',
  confirmation_work_id_tag_id_fkey: '이 작업에 없는 확인 항목이에요',
  confirmation_tag_id_check_item_id_fkey: '이 작업에 없는 확인 항목이에요',
  work_one_active_per_device: '이 단말에 이미 진행 중인 작업이 있어요. 먼저 종료한 뒤 시작해 주세요',
  work_cancel_before_start: '작업이 시작된 뒤에는 취소할 수 없어요. 작업 종료로 처리해 주세요',
  work_started_before_end: '작업을 시작한 뒤에 종료할 수 있어요',
  work_permit_window: '허가 시작 시각이 끝 시각보다 앞이어야 해요',
  dispatch_alert_id_key: '이 알림은 이미 출동했어요',
  scan_one_active: '활성 스캔은 현장마다 하나예요',
  event_type_check: '기록할 수 없는 이벤트 종류예요',
  work_device_id_fkey: '등록되지 않은 단말이에요',
  alert_device_id_fkey: '등록되지 않은 단말이에요',
  confirmation_device_id_fkey: '등록되지 않은 단말이에요',
  work_zone_id_fkey: '구역을 선택해 주세요',
  alert_zone_id_fkey: '없는 구역이에요',
  tag_zone_id_fkey: '없는 구역이에요',
  drawing_zone_zone_id_fkey: '없는 구역이에요',
  work_tag_tag_id_fkey: '없는 태그예요',
  tag_supersedes_tag_id_key: '이미 수정된 예전 버전이에요. 최신 버전에서 수정해 주세요',
};

export function dbMessage(e: PgError): string {
  const c = e.constraint;
  if (c && BY_CONSTRAINT[c]) return BY_CONSTRAINT[c];
  if (c?.endsWith('_media_id_key')) return '이미 다른 곳에 쓰인 파일이에요';
  if (c?.endsWith('_media_id_fkey')) return '없는 파일이에요';
  switch (e.code) {
    case '23505':
      return `중복된 값이에요 (${c ?? e.message})`;
    case '23503':
      return `참조하는 대상이 없어요 (${c ?? e.message})`;
    case '23502':
      return `필수 값이 비었어요 (${e.column ?? e.message})`;
    case '23514':
      return c ? `허용되지 않는 값이에요 (${c})` : e.message;
    case '22P02':
      return `형식이 잘못된 값이에요: ${e.message}`;
    default:
      return e.message;
  }
}

/**
 * DB 가 막은 쓰기 → 400 + 한국어 message (프론트 lib/api.ts 가 message 를 그대로 보여준다).
 * SQLSTATE 23xxx(무결성) · 22xxx(값 형식). 나머지는 Nest 기본 처리(HttpException 그대로, 그 외 500).
 */
@Catch()
export class DbErrorFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    const pg = asPgError(exception);
    if (pg && (pg.code.startsWith('23') || pg.code.startsWith('22'))) {
      return super.catch(
        new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: dbMessage(pg),
          code: pg.code,
          constraint: pg.constraint ?? null,
        }),
        host,
      );
    }
    return super.catch(exception, host);
  }
}
