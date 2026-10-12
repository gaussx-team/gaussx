import { execFileSync } from 'node:child_process';
import { SERVER_ROOT } from './paths.js';

function commit(): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: SERVER_ROOT, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (out) return out;
  } catch {
    // git 이 없거나 저장소 밖에서 돌고 있다
  }
  return 'unknown';
}

/** 지금 돌고 있는 코드가 어느 커밋인가 (시작 로그 · GET /api/health) */
export const VERSION = commit();
