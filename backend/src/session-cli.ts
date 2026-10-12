import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.js';
import { loadSettings } from './config/settings.js';
import { DB, type Db } from './db/db.js';
import { SessionService } from './db/session.service.js';
import { SERVER_ROOT } from './paths.js';

// 서버를 켜지 않고 새 회차(스키마 + 데모 데이터)를 만든다: 무대에 올라가기 직전 · 리허설 사이
//   npm run session:new -- "11/5 본 무대"
const envFile = join(SERVER_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const note = process.argv.slice(2).join(' ') || '새 회차 (명령)';
const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadSettings()), { logger: ['warn', 'error'] });
try {
  await app.init();
  const sessions = app.get(SessionService);
  // 회차가 하나도 없던 DB 면 켜면서 이미 새 회차를 만들었다 → 그 회차에 메모만 붙인다
  const name = sessions.createdOnBoot ? sessions.current! : await sessions.start(note);
  if (sessions.createdOnBoot) await sessions.setNote(name, note);
  console.log(`새 회차 ${name} — ${app.get<Db>(DB).label}`);
} catch (e) {
  console.error(`새 회차를 만들지 못했습니다:\n  ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
