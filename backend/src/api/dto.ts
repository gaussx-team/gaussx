// 요청 본문 · 쿼리. 프론트(frontend/src/app/**)가 보내는 모양 그대로 받는다 — 빠진 값의 한국어 안내는 서비스가 한다.
// 형식만 여기서 본다 (숫자 자리에 글자 등). 모르는 필드는 버린다(whitelist).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const NUM = { allowNaN: false, allowInfinity: false };

// ── 태그 ────────────────────────────────────────────────────────
export class CheckItemBody {
  @ApiPropertyOptional({ example: '산소 농도 측정' }) @IsOptional() @IsString() @MaxLength(200) item?: string;
  @ApiPropertyOptional({ enum: ['none', 'value', 'photo'] }) @IsOptional() @IsIn(['none', 'value', 'photo']) needs?: 'none' | 'value' | 'photo';
  @ApiPropertyOptional({ example: '%' }) @IsOptional() @IsString() @MaxLength(20) unit?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional({ example: 18 }) @IsOptional() @IsNumber(NUM) min?: number | null;
  @ApiPropertyOptional({ example: 23.5 }) @IsOptional() @IsNumber(NUM) max?: number | null;
  @ApiPropertyOptional({ description: 'true 면 최대값 미만 (법정 기준 "~미만")' }) @IsOptional() @IsBoolean() maxExclusive?: boolean | null;
}

export class TagBody {
  @ApiPropertyOptional({ example: 'Z1' }) @IsOptional() @IsString() zoneId?: string;
  @ApiPropertyOptional({ example: '배관 P-203' }) @IsOptional() @IsString() @MaxLength(100) title?: string;
  @ApiPropertyOptional({ example: '불산 55%' }) @IsOptional() @IsString() @MaxLength(100) substance?: string | null;
  @ApiPropertyOptional({ example: '피부 접촉 시 중증 화상' }) @IsOptional() @IsString() @MaxLength(300) hazard?: string;
  @ApiPropertyOptional({ example: '구조 시 내산 보호구 착용 후 접근' }) @IsOptional() @IsString() @MaxLength(300) emergencyNote?: string | null;
  @ApiPropertyOptional({ enum: ['running', 'stopped', 'valve_open', 'valve_closed', 'deteriorated'] }) @IsOptional() @IsString() equipmentState?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() official?: boolean;
  @ApiPropertyOptional({ example: 1.2, description: '바닥 좌표 (m) — 3D 연동 전 임시' }) @IsOptional() @IsNumber(NUM) x?: number;
  @ApiPropertyOptional({ example: 0.45 }) @IsOptional() @IsNumber(NUM) y?: number;
  @ApiPropertyOptional({ description: '3D 연동 후 높이 (m)' }) @IsOptional() @IsNumber(NUM) z?: number | null;
  @ApiPropertyOptional({ type: [CheckItemBody] })
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CheckItemBody)
  checkItems?: CheckItemBody[];
}

export class TagReviseBody {
  @ApiProperty({ example: 1 }) @IsInt() tagId: number;
  @ApiProperty({ type: TagBody }) @ValidateNested() @Type(() => TagBody) patch: TagBody;
}

export class TagIdBody {
  @ApiProperty({ example: 3 }) @IsInt() tagId: number;
}

// ── 작업 ────────────────────────────────────────────────────────
export class WorkBody {
  @ApiPropertyOptional({ example: 'P-203 배관 플랜지 교체' }) @IsOptional() @IsString() @MaxLength(100) title?: string;
  @ApiPropertyOptional({ example: 'Z1' }) @IsOptional() @IsString() zoneId?: string;
  @ApiPropertyOptional({ example: 'device-01' }) @IsOptional() @IsString() deviceId?: string;
  @ApiPropertyOptional({ example: [7, 2] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsInt({ each: true }) tagIds?: number[];
  @ApiPropertyOptional({ example: '작업허가서_예시.pdf' }) @IsOptional() @IsString() @MaxLength(200) permitName?: string | null;
  @ApiPropertyOptional({ description: '작업허가서 PDF 내용 (data:application/pdf;base64,…). 없으면 이름만 남는다' })
  @IsOptional() @IsString() permitFile?: string | null;
  @ApiPropertyOptional({ description: '허가서 링크 (원청 시스템 주소 등)' }) @IsOptional() @IsString() @MaxLength(2000) permitUrl?: string | null;
  @ApiPropertyOptional({ example: '2026-11-05T09:00:00+09:00' }) @IsOptional() @IsISO8601() permitStart?: string | null;
  @ApiPropertyOptional({ example: '2026-11-05T17:00:00+09:00' }) @IsOptional() @IsISO8601() permitEnd?: string | null;
}

export class WorkIdBody {
  @ApiProperty({ example: 9 }) @IsInt() workId: number;
}

export class CancelBody extends WorkIdBody {
  @ApiPropertyOptional({ example: '자재 미입고' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class ConfirmBody extends WorkIdBody {
  @ApiProperty({ example: 14 }) @IsInt() checkItemId: number;
  @ApiPropertyOptional({ example: 0 }) @IsOptional() @IsNumber(NUM) value?: number | null;
  @ApiPropertyOptional({ description: '사진: data URL(파일 내용) 또는 파일 이름(목업 호환 · 증빙 안 됨)' })
  @IsOptional() @IsString() photo?: string | null;
  @ApiPropertyOptional({ description: 'POST /api/media 로 먼저 올린 사진' }) @IsOptional() @IsInt() photoMediaId?: number | null;
}

export class CardQuery {
  @ApiPropertyOptional({ example: 'device-01' }) @IsOptional() @IsString() device?: string;
  @ApiPropertyOptional({ example: 9, description: '작업 하나 (관리자 미리보기)' }) @IsOptional() @Type(() => Number) @IsInt() work?: number;
}

export class DeviceQuery {
  @ApiPropertyOptional({ example: 'device-01' }) @IsOptional() @IsString() device?: string;
}

// ── 알림 ────────────────────────────────────────────────────────
export class EventBody {
  @ApiPropertyOptional({ enum: ['sos_button', 'accel', 'operator', 'debug'], default: 'debug', description: '수동 SOS · 자동 감지 · 관제 직접 출동 · 무대 트리거' })
  @IsOptional() @IsIn(['sos_button', 'accel', 'operator', 'debug'])
  source?: 'sos_button' | 'accel' | 'operator' | 'debug';
  @ApiPropertyOptional({ example: 'device-01' }) @IsOptional() @IsString() deviceId?: string | null;
  @ApiPropertyOptional({ example: 'Z1', description: '비우면 헬멧 비콘이 들어가 있는 구역 → 그 단말의 작업 중 구역' }) @IsOptional() @IsString() zoneId?: string | null;
  @ApiPropertyOptional({ example: 0.91 }) @IsOptional() @IsNumber(NUM) @Min(0) @Max(1) confidence?: number;
  @ApiPropertyOptional({ example: { freefall_ms: 480, peak_g: 4.7 } }) @IsOptional() @IsObject() signal?: Record<string, unknown>;
  @ApiPropertyOptional({ description: '가속도 [[t, g], ...]' }) @IsOptional() @IsArray() @ArrayMaxSize(2000) buffer?: unknown[];
}

export class AlertIdBody {
  @ApiProperty({ example: 3 }) @IsInt() alertId: number;
}

export class ResolveBody extends AlertIdBody {
  @ApiPropertyOptional({ enum: ['handled', 'false_alarm'], default: 'handled' }) @IsOptional() @IsIn(['handled', 'false_alarm']) resolution?: 'handled' | 'false_alarm';
}

export class RobotModeBody {
  @ApiProperty({ enum: ['ready', 'charging', 'maintenance', 'offline'] }) @IsString() mode: string;
}

// ── 도면 ────────────────────────────────────────────────────────
export class DrawingBody {
  @ApiPropertyOptional({ example: '2구역 탱크 배치도' }) @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional({ enum: ['floor', 'pid', 'electrical', 'other'] }) @IsOptional() @IsString() kind?: string;
  @ApiPropertyOptional({ example: 'A-102' }) @IsOptional() @IsString() @MaxLength(50) dwgNo?: string | null;
  @ApiPropertyOptional({ example: 'REV.A' }) @IsOptional() @IsString() @MaxLength(50) revision?: string | null;
  @ApiPropertyOptional({ example: ['Z2'] }) @IsOptional() @IsArray() @IsString({ each: true }) zoneIds?: string[];
  @ApiPropertyOptional({ example: ['T-02'] }) @IsOptional() @IsArray() @IsString({ each: true }) equipment?: string[];
  @ApiPropertyOptional({ example: 'A-102_탱크.pdf' }) @IsOptional() @IsString() @MaxLength(300) fileName?: string;
  @ApiPropertyOptional({ example: 'application/pdf' }) @IsOptional() @IsString() mime?: string | null;
  @ApiPropertyOptional({ description: '파일 내용 base64 (20MB 까지)' }) @IsOptional() @IsString() dataBase64?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

// ── 비콘 수신기 ───────────────────────────────────────────────────
export class GatewayReadingBody {
  @ApiProperty({ example: '9d299ff3-5431-40e6-85d6-4ac08806000e:1:1', description: 'iBeacon "uuid:major:minor"' })
  @IsString() @MaxLength(80) beaconId: string;
  @ApiProperty({ example: [-61, -63, -60], description: '지난 1초 동안 받은 RSSI (dBm)' })
  @IsArray() @ArrayMaxSize(200) @IsNumber(NUM, { each: true }) rssi: number[];
  @ApiPropertyOptional({ example: -59, description: '비콘이 알린 1m 기준 세기 (참고용)' })
  @IsOptional() @IsNumber(NUM) txPower?: number;
}

export class GatewayBody {
  @ApiProperty({ example: 'gw-01' }) @IsString() @MaxLength(50) gatewayId: string;
  @ApiProperty({ type: [GatewayReadingBody], description: '비어 있어도 된다 (수신기가 살아 있다는 신호)' })
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => GatewayReadingBody)
  readings: GatewayReadingBody[];
}

export class RadarQuery {
  @ApiProperty({ example: 'gw-01', description: '이 수신기 기준으로 (x = 오른쪽, y = 앞 · 구역 쪽)' }) @IsString() @MaxLength(50) gateway: string;
}

export class CalibrateBody {
  @ApiProperty({ example: 'gw-01' }) @IsString() @MaxLength(50) gatewayId: string;
  @ApiPropertyOptional({ description: '이 비콘으로 (비우면 이 수신기에 가장 세게 들리는 비콘)' }) @IsOptional() @IsString() @MaxLength(80) beaconId?: string;
  @ApiPropertyOptional({ description: 'true 면 보정을 지운다' }) @IsOptional() @IsBoolean() reset?: boolean;
}

export class GatewaySettingsBody {
  @ApiProperty({ example: 'gw-02' }) @IsString() @MaxLength(50) gatewayId: string;
  @ApiPropertyOptional({ example: 'Z1', description: '이 수신기가 지키는 구역' }) @IsOptional() @IsString() @MaxLength(50) zoneId?: string;
  @ApiPropertyOptional({ example: 3, description: '바닥 x (m) — 실제로 놓은 자리' }) @IsOptional() @IsNumber(NUM) x?: number;
  @ApiPropertyOptional({ example: 1.5, description: '바닥 y (m)' }) @IsOptional() @IsNumber(NUM) y?: number;
  @ApiPropertyOptional({ example: -58, nullable: true, description: '1m 세기 (dBm). null = 이 수신기만의 값 없음 (공통 값 · 비콘이 알린 값)' })
  @IsOptional() @IsNumber(NUM) ref1mDbm?: number | null;
  @ApiPropertyOptional({ description: 'true 면 이 수신기를 씬 값으로 되돌린다' }) @IsOptional() @IsBoolean() reset?: boolean;
}

export class IdQuery {
  @ApiProperty({ example: 5 }) @Type(() => Number) @IsInt() id: number;
}

export class HistoryQuery {
  @ApiPropertyOptional({ example: 'today', description: 'YYYY-MM-DD · today · all (KST)' }) @IsOptional() @IsString() day?: string;
  @ApiPropertyOptional({ example: 'work,alert', description: 'work · check · alert · robot · tag · system (쉼표)' }) @IsOptional() @IsString() cat?: string;
  @ApiPropertyOptional({ example: 'Z1' }) @IsOptional() @IsString() zone?: string;
  @ApiPropertyOptional({ example: 9 }) @IsOptional() @Type(() => Number) @IsInt() work?: number;
  @ApiPropertyOptional({ example: 'P-203' }) @IsOptional() @IsString() q?: string;
}
