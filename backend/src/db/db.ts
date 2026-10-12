import { mkdirSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

export const DB = 'DB';

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 여러 문장을 한 번에 (마이그레이션). 인자 없음 */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  /** 시작할 때 보여줄 한 줄 */
  readonly label: string;
  /** 지금 회차(세션)의 스키마. 모든 쿼리가 이 스키마의 테이블을 본다 */
  readonly schema: string | null;
  useSchema(name: string): Promise<void>;
  /** 상태 변경 + 이벤트 = 한 트랜잭션. 예외가 나면 둘 다 취소된다 */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** 회차 스키마 이름만 받는다 (SQL 에 그대로 들어가므로) */
export function assertSchemaName(name: string): string {
  if (!/^gx_[0-9a-z_]{1,50}$/.test(name)) throw new Error(`스키마 이름이 올바르지 않습니다: ${name}`);
  return name;
}

/**
 * jsonb 인자. pg 는 JS 배열을 PostgreSQL 배열 문법으로 보내서 jsonb 에 넣으면 깨진다.
 * 직접 문자열로 만들고 SQL 에서 `$n::jsonb` 로 받는다.
 */
export const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

/** text[] 인자: JSON 배열 문자열로 보내고 SQL 에서 `ARRAY(SELECT jsonb_array_elements_text($n::jsonb))` */
export const textArray = (v: string[]): string => JSON.stringify(v);

/** `IN (...)` 자리표시자. offset = 앞에 이미 쓴 인자 수 */
export const placeholders = (n: number, offset = 0): string =>
  Array.from({ length: n }, (_, i) => `$${i + 1 + offset}`).join(', ');

export function openDb(o: { databaseUrl: string | null; pgliteDir: string }): Promise<Db> {
  return o.databaseUrl ? openPostgres(o.databaseUrl) : openPglite(o.pgliteDir);
}

// ── PostgreSQL (무대 · 팀 개발) ───────────────────────────────────

const wrap = (c: Pool | PoolClient): Queryable => ({
  query: async <T>(sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as T[],
  exec: async (sql: string) => {
    await c.query(sql);
  },
});

class PostgresDb implements Db {
  readonly kind = 'postgres' as const;
  schema: string | null = null;
  private pool: Pool;

  constructor(
    private readonly url: string,
    readonly label: string,
  ) {
    this.pool = this.makePool(null);
  }

  // 회차를 바꾸면 풀을 새로 만든다: 접속할 때 search_path 를 정해 두면 쿼리마다 SET 할 필요가 없다
  private makePool(schema: string | null): Pool {
    const pool = new pg.Pool({
      connectionString: this.url,
      max: 10,
      options: schema ? `-c search_path=${schema}` : undefined,
    });
    pool.on('error', (e) => console.error(`PostgreSQL 연결 오류: ${e.message}`));
    return pool;
  }

  async useSchema(name: string): Promise<void> {
    const old = this.pool;
    this.pool = this.makePool(assertSchemaName(name));
    this.schema = name;
    await this.pool.query('SELECT 1');
    void old.end().catch(() => undefined);
  }

  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
    return wrap(this.pool).query<T>(sql, params);
  }

  exec(sql: string): Promise<void> {
    return wrap(this.pool).exec(sql);
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(wrap(client));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

async function openPostgres(url: string): Promise<Db> {
  const shown = url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
  const probe = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await probe.query<{ version: string; db: string }>(
      "SELECT current_setting('server_version') AS version, current_database() AS db",
    );
    return new PostgresDb(url, `PostgreSQL ${rows[0].version} · ${rows[0].db} (${shown})`);
  } catch (e) {
    throw new Error(
      `PostgreSQL 에 연결하지 못했습니다 (${shown}): ${(e as Error).message}\n` +
        '  서비스가 켜져 있는지, DB 를 만들었는지 확인하세요. 설치 없이 개발하려면 DATABASE_URL 을 비우면 PGlite 로 돈다.',
    );
  } finally {
    await probe.end().catch(() => undefined);
  }
}

// ── PGlite (개발 · 테스트: 설치 없는 PostgreSQL 17, WASM) ─────────

class PgliteDb implements Db {
  readonly kind = 'pglite' as const;
  schema: string | null = null;

  constructor(
    private readonly pg: PGlite,
    readonly label: string,
  ) {}

  async useSchema(name: string): Promise<void> {
    await this.pg.exec(`SET search_path TO ${assertSchemaName(name)}`);
    this.schema = name;
  }

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(sql, params)).rows;
  }

  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    // PGlite 는 연결이 하나다. 트랜잭션 안에서 바깥 db.query 를 부르면 서로 기다리다 멈추므로
    // 콜백에는 반드시 넘겨받은 q 만 쓴다 (PostgreSQL 에서도 같은 규칙).
    return this.pg.transaction((t) =>
      fn({
        query: async <R>(sql: string, params: unknown[] = []) => (await t.query<R>(sql, params)).rows,
        exec: async (sql: string) => {
          await t.exec(sql);
        },
      }),
    );
  }

  close(): Promise<void> {
    return this.pg.close();
  }
}

async function openPglite(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const memory = dir.startsWith('memory://');
  if (!memory) mkdirSync(dir, { recursive: true });
  const pgl = await PGlite.create(memory ? undefined : dir);
  const [{ version }] = (
    await pgl.query<{ version: string }>("SELECT current_setting('server_version') AS version")
  ).rows;
  return new PgliteDb(pgl, `PGlite (PostgreSQL ${version}) · ${memory ? '메모리' : dir} — 개발용`);
}
