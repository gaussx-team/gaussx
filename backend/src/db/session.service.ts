import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigSync } from '../config/config-sync.service.js';
import { Seeder } from '../seed/seeder.js';
import { assertSchemaName, DB, type Db } from './db.js';
import { EventsService } from './events.service.js';
import { migrate } from './migrate.js';

/**
 * 데모 회차(세션) = PostgreSQL 스키마 하나.
 *
 * '데모 리셋'은 화면을 처음 상태로 되돌려야 하지만, 기록(확인 · 이벤트)은 고치거나 지우지 않는다.
 * 그래서 지우는 대신 **새 스키마에 새 회차**를 만들고 그쪽으로 옮긴다. 지난 회차는 자기 스키마에 그대로 남는다.
 * 회차 목록: public.gx_session. 서버는 가장 최근 회차로 켜진다.
 */
@Injectable()
export class SessionService implements OnModuleInit {
  private readonly log = new Logger('Session');
  /** 켜질 때 회차가 없어서 새로 만들었나 (session-cli 가 두 번 만들지 않게) */
  createdOnBoot = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigSync,
    private readonly seeder: Seeder,
    private readonly events: EventsService,
  ) {}

  get current(): string | null {
    return this.db.schema;
  }

  async onModuleInit() {
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS public.gx_session (
         name        text PRIMARY KEY,
         created_at  timestamptz NOT NULL DEFAULT now(),
         note        text
       )`,
    );
    const [last] = await this.db.query<{ name: string }>(
      'SELECT name FROM public.gx_session ORDER BY created_at DESC, name DESC LIMIT 1',
    );
    if (!last) {
      await this.start('첫 실행');
      this.createdOnBoot = true;
      return;
    }
    const applied = await migrate(this.db, last.name);
    await this.db.useSchema(last.name);
    if (applied.length) this.log.log(`${last.name} 마이그레이션: ${applied.join(', ')}`);
    await this.config.sync();
  }

  /** 새 회차: 스키마 → DDL → 설정 → 데모 데이터 → 그쪽으로 전환 */
  async start(note: string): Promise<string> {
    const name = await this.newName();
    await this.db.tx(async (q) => {
      await q.exec(`CREATE SCHEMA ${name}`);
      await q.query('INSERT INTO public.gx_session (name, note) VALUES ($1, $2)', [name, note]);
    });
    await migrate(this.db, name);
    await this.db.useSchema(name);
    await this.config.sync();
    const seeded = await this.seeder.seed();
    await this.db.tx((q) =>
      this.events.log(q, {
        type: 'session.reset',
        actor: 'system',
        text: note === '첫 실행' ? `새 회차 ${name}` : `데모 리셋 · 새 회차 ${name}`,
        payload: { session: name, note, seeded },
      }),
    );
    this.log.log(`새 회차 ${name} (${note})`);
    return name;
  }

  async setNote(name: string, note: string): Promise<void> {
    await this.db.query('UPDATE public.gx_session SET note = $2 WHERE name = $1', [name, note]);
  }

  async list(): Promise<{ name: string; created_at: Date; note: string | null }[]> {
    return this.db.query('SELECT name, created_at, note FROM public.gx_session ORDER BY created_at DESC, name DESC');
  }

  /** gx_20261105_142101 (KST). 같은 초에 두 번이면 _2, _3 … */
  private async newName(): Promise<string> {
    const kst = new Date(Date.now() + 9 * 3_600_000).toISOString();
    const base = `gx_${kst.slice(0, 10).replace(/-/g, '')}_${kst.slice(11, 19).replace(/:/g, '')}`;
    const taken = new Set((await this.db.query<{ name: string }>('SELECT name FROM public.gx_session WHERE name LIKE $1', [`${base}%`])).map((r) => r.name));
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${base}_${n}`;
      if (!taken.has(name)) return assertSchemaName(name);
    }
  }
}
