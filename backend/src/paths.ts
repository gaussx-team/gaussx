import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** backend/ 폴더. 빌드 결과는 dist/src/ 에서 돌기 때문에 두 단계 위다 */
export const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 스키마 원본 (docs/ERD.md). 코드가 스키마를 만들지 않는다 */
export const MIGRATIONS_DIR = join(SERVER_ROOT, 'db', 'migrations');

/** SCENE_DIR 을 주지 않았을 때 쓰는 개발용 씬 (프론트 목업과 같은 4×3m 바닥 · 구역 · 경로 · 데모 데이터) */
export const DEV_SCENE_DIR = join(SERVER_ROOT, 'scenes', 'dev');
