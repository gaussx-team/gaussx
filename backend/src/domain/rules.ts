// 화면과 같은 규칙을 서버에서도 쓴다 (frontend/src/lib/format.ts 와 같아야 한다)

export type Needs = 'none' | 'value' | 'photo';
export type WorkStatus = 'published' | 'opened' | 'confirmed' | 'ended' | 'cancelled';
export type RobotMode = 'ready' | 'charging' | 'maintenance' | 'offline';
export type AlertSource = 'sos_button' | 'accel' | 'operator' | 'debug' | 'reading';
export type EventCategory = 'work' | 'check' | 'alert' | 'robot' | 'tag' | 'system';

export interface Range {
  min?: number | null;
  max?: number | null;
  maxExclusive?: boolean | null;
  unit?: string | null;
}

/** 정상 범위 안인가 (최소는 이상, 최대는 이하 또는 미만) */
export const inRange = (c: Range, v: number) =>
  !(c.min != null && v < c.min) && !(c.max != null && (c.maxExclusive ? v >= c.max : v > c.max));

/** 정상 범위 문구: "18% 이상 23.5% 미만", "0V", "10%LEL 미만" */
export const fmtRange = (c: Range) => {
  const u = c.unit ?? '';
  if (c.min != null && c.max != null && c.min === c.max) return `${c.min}${u}`;
  const parts: string[] = [];
  if (c.min != null && !(c.min === 0 && c.max != null)) parts.push(`${c.min}${u} 이상`);
  if (c.max != null) parts.push(`${c.max}${u} ${c.maxExclusive ? '미만' : '이하'}`);
  return parts.join(' ');
};

export const isOpen = (status: WorkStatus) => status !== 'ended' && status !== 'cancelled';

/** 이벤트 종류 → 이력 필터 분류 */
export const eventCategory = (type: string): EventCategory => {
  const head = type.split('.')[0];
  if (head === 'work' || head === 'card') return 'work';
  if (head === 'check') return 'check';
  if (head === 'alert') return 'alert';
  if (head === 'dispatch' || head === 'robot') return 'robot';
  if (head === 'tag') return 'tag';
  return 'system';
};

export const ROBOT_MODE_LABEL: Record<RobotMode, string> = {
  ready: '출동 대기',
  charging: '충전 중',
  maintenance: '점검 중',
  offline: '연결 끊김',
};

// ── 날짜는 서버 시간대와 상관없이 한국 시간(KST) 기준 ─────────────
const KST_MS = 9 * 3_600_000;
/** KST 날짜 키 YYYY-MM-DD */
export const dayKey = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
/** KST 그날 0시 */
export const startOfDay = (key: string) => new Date(`${key}T00:00:00+09:00`);
export const isDayKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(startOfDay(s).getTime());
