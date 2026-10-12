import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from '../paths.js';
import { assertSchemaName, type Db } from './db.js';

/**
 * db/migrations/*.sql 을 이름 순서로, 그 회차 스키마에 아직 넣지 않은 것만 넣는다. 파일 하나 = 트랜잭션 하나.
 * ORM 의 자동 동기화는 쓰지 않는다: 트리거 · 복합 FK · 부분 인덱스를 모른다.
 */
export async function migrate(db: Db, schema: string, dir = MIGRATIONS_DIR): Promise<string[]> {
  const s = assertSchemaName(schema);
  const [{ present }] = await db.query<{ present: boolean }>(
    `SELECT to_regclass('${s}._migrations') IS NOT NULL AS present`,
  );
  if (!present) {
    await db.exec(`CREATE TABLE ${s}._migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  }
  const done = new Set((await db.query<{ name: string }>(`SELECT name FROM ${s}._migrations`)).map((r) => r.name));

  const applied: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(join(dir, name), 'utf8');
    try {
      await db.tx(async (q) => {
        // 파일 안의 이름은 스키마를 적지 않는다 → 이 트랜잭션 동안만 회차 스키마를 본다
        await q.exec(`SET LOCAL search_path TO ${s}`);
        await q.exec(sql);
        await q.query(`INSERT INTO ${s}._migrations (name) VALUES ($1)`, [name]);
      });
    } catch (e) {
      throw new Error(`${name} 을 ${s} 에 넣지 못했습니다: ${(e as Error).message}`);
    }
    applied.push(name);
  }
  return applied;
}
