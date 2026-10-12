import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { ComputeClient } from './compute/compute.client.js';
import { SCENE, type Scene } from './config/scene.js';
import { loadSettings } from './config/settings.js';
import { DB, type Db } from './db/db.js';
import { SERVER_ROOT } from './paths.js';
import { VERSION } from './version.js';

// .env 는 backend/ 에 둔다 (저장소에는 .env.example 만)
const envFile = join(SERVER_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const lanAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n!.address);

async function main() {
  const s = loadSettings();
  const app = await createApp(s);
  app.enableShutdownHooks();
  await app.listen(s.port, s.host);

  const db = app.get<Db>(DB);
  const scene = app.get<Scene>(SCENE);
  const compute = app.get(ComputeClient).current();
  const ips = lanAddresses();
  console.log(
    [
      '',
      `GaussX 백엔드 ${VERSION}`,
      `  DB     ${db.label}`,
      `  회차   ${db.schema}`,
      `  씬     ${scene.dir}${s.devScene ? '  ← 개발용 씬 (SCENE_DIR 미설정)' : ''}`,
      `  계산   ${compute.url ?? '부르지 않음'} → ${compute.ok ? '실시간 계산' : `사전 계산표${compute.error ? ` (${compute.error})` : ''}`}`,
      `  파일   ${s.filesDir}`,
      ...scene.notes.map((n) => `  ! ${n}`),
      '',
      `  API    http://127.0.0.1:${s.port}/docs`,
      `  프론트 frontend/.env.local → NEXT_PUBLIC_API_BASE_URL=http://${ips[0] ?? '127.0.0.1'}:${s.port}`,
      ...ips.slice(1).map((ip) => `         (다른 망) http://${ip}:${s.port}`),
      '',
    ].join('\n'),
  );
}

main().catch((e: unknown) => {
  const err = e as { code?: string; message?: string };
  const hint = err?.code === 'EADDRINUSE' ? '\n  포트를 이미 쓰고 있습니다. 서버가 이미 켜져 있나요? (PORT 로 바꿀 수 있다)' : '';
  console.error(`\n서버를 시작하지 못했습니다:\n  ${err?.message ?? String(e)}${hint}\n`);
  process.exit(1);
});
