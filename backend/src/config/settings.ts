import { isAbsolute, join, resolve } from 'node:path';
import { DEV_SCENE_DIR, SERVER_ROOT } from '../paths.js';

export const SETTINGS = 'SETTINGS';

export interface Settings {
  port: number;
  host: string;
  /** postgres://… 를 주면 PostgreSQL, 비우면 PGlite(내장 PostgreSQL · 개발용) */
  databaseUrl: string | null;
  /** PGlite 데이터 폴더. 'memory://' 로 시작하면 메모리 (테스트) */
  pgliteDir: string;
  sceneDir: string;
  /** SCENE_DIR 을 주지 않아 개발용 씬을 쓰는 중 */
  devScene: boolean;
  /** 올린 파일(사진 · 허가서 · 도면)이 회차별 폴더에 쌓인다 */
  filesDir: string;
  /** 계산 서비스. null 이면 부르지 않고 사전 계산표만 쓴다 */
  computeUrl: string | null;
  /** 로봇 도착 타이머 배속. 1 = 실제 시간. 테스트에서만 키운다 */
  dispatchSpeed: number;
  /** 관리자 화면에서 바꾼 비콘 수신기 자리 · 구역 · 1m 세기 (씬 값 위에 덮어쓴다. 회차 · 재시작과 상관없이 남는다) */
  gatewaysFile: string;
}

/** 환경 변수 → 설정. 상대 경로는 backend/ 기준 */
export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const path = (value: string | undefined, fallback: string) =>
    value ? (isAbsolute(value) ? value : resolve(SERVER_ROOT, value)) : fallback;

  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT 가 올바르지 않습니다: ${env.PORT}`);
  }
  const speed = Number(env.DISPATCH_SPEED || 1);
  if (!(speed > 0)) throw new Error(`DISPATCH_SPEED 는 0 보다 커야 합니다: ${env.DISPATCH_SPEED}`);

  const compute = env.COMPUTE_URL ?? 'http://127.0.0.1:8766';
  const pglite = env.PGLITE_DIR || '.data/pglite';
  return {
    port,
    host: env.HOST || '0.0.0.0',
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: pglite.startsWith('memory://') ? pglite : path(pglite, pglite),
    sceneDir: path(env.SCENE_DIR, DEV_SCENE_DIR),
    devScene: !env.SCENE_DIR,
    filesDir: path(env.FILES_DIR, join(SERVER_ROOT, '.data', 'files')),
    computeUrl: compute && compute !== 'off' ? compute.replace(/\/+$/, '') : null,
    dispatchSpeed: speed,
    gatewaysFile: path(env.GATEWAYS_FILE, join(SERVER_ROOT, '.data', 'gateways.json')),
  };
}
