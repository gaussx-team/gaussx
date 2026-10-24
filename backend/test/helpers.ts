import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import type { Route } from '../src/config/scene.js';
import { loadSettings } from '../src/config/settings.js';
import { DB, type Db } from '../src/db/db.js';
import { DEV_SCENE_DIR } from '../src/paths.js';

// 테스트는 응답 JSON 을 바로 들여다보므로 본문 타입은 any 로 둔다

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 5000, what = '조건'): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`${what}: ${ms}ms 안에 만족하지 않았습니다`);
    await sleep(25);
  }
}

/** 1×1 PNG */
export const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
/** SOF0 만 있는 JPEG 머리 (가로 3 · 세로 2). 디코딩은 안 되지만 형식 판별 · 크기 읽기에는 충분하다 */
export const JPEG_3x2 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03,
  0x11, 0x01, 0xff, 0xd9,
]);
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
export const dataUrl = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString('base64')}`;

const ROUTES = JSON.parse(readFileSync(join(DEV_SCENE_DIR, 'demo', 'routes.json'), 'utf8')) as { routes: Route[] };
export function devRoute(from: string, to: string): Route {
  const r = ROUTES.routes.find((x) => x.from === from && x.to === to);
  if (!r) throw new Error(`개발용 씬 routes.json 에 ${from} → ${to} 가 없습니다`);
  return r;
}

export interface Reply {
  status: number;
  body: any;
}

export interface TestServer {
  base: string;
  db: Db;
  /** 서버 안의 서비스 (테스트에서 시계를 바꿔 끼울 때) */
  get<T>(token: abstract new (...args: never[]) => T): T;
  call(method: string, path: string, body?: unknown): Promise<Reply>;
  /** 2xx 를 기대하고 본문을 돌려준다 */
  ok(method: string, path: string, body?: unknown): Promise<any>;
  /** 이 상태 코드를 기대하고 본문을 돌려준다 */
  fail(method: string, path: string, body: unknown, status: number): Promise<any>;
  close(): Promise<void>;
}

/**
 * 실제 서버를 임의 포트로 띄운다. 기본: PGlite 메모리 · 계산 서비스 꺼짐 · 개발용 씬(데모 데이터) · 출동 20배속.
 * env 로 무엇이든 덮어쓴다 (PGLITE_DIR · COMPUTE_URL · SCENE_DIR · DISPATCH_SPEED …)
 */
export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const files = mkdtempSync(join(tmpdir(), 'gx-files-'));
  const settings = loadSettings({
    PGLITE_DIR: 'memory://',
    COMPUTE_URL: 'off',
    FILES_DIR: files,
    GATEWAYS_FILE: join(files, 'gateways.json'), // 수신기 설정은 서버마다 따로 (repo 의 .data 를 건드리지 않게)
    DISPATCH_SPEED: '20',
    ...env,
  });
  const app = await createApp(settings, ['error']);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  const call = async (method: string, path: string, body?: unknown): Promise<Reply> => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // JSON 이 아닌 응답은 문자열 그대로
    }
    return { status: res.status, body: parsed };
  };

  return {
    base,
    db: app.get<Db>(DB),
    get: (token) => app.get(token),
    call,
    async ok(method, path, body) {
      const r = await call(method, path, body);
      assert.ok(r.status >= 200 && r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
      return r.body;
    },
    async fail(method, path, body, status) {
      const r = await call(method, path, body);
      assert.equal(r.status, status, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
      return r.body;
    },
    async close() {
      await app.close();
      rmSync(files, { recursive: true, force: true });
    },
  };
}

/** 데모 작업 W-009 (device-01 · Z1 · 태그 7 = P-203 v2, 태그 2 = V-11) 의 확인 항목 id */
export const DEMO = {
  work: 9,
  pressure: 14, // 배관 잔압 0 확인 · value bar 0~0 · 필수
  lockPhoto: 15, // 밸브 잠금·표지 부착 · photo · 필수
  ppe: 16, // 내산 보호구 착용 · 필수
  eyewash: 17, // 세안·샤워 설비 위치 확인 · 선택
  oxygen: 5, // 산소 농도 측정 · 18% 이상 23.5% 미만 · 필수 (태그 2)
} as const;

/** 데모 작업을 작업 중(confirmed)으로: 열람 → 필수 확인 4개 → 확인 완료 */
export async function startDemoWork(s: TestServer) {
  await s.ok('POST', '/api/card/opened', { workId: DEMO.work });
  await s.ok('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.pressure, value: 0 });
  await s.ok('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.lockPhoto, photo: 'lock.jpg' });
  await s.ok('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.ppe });
  await s.ok('POST', '/api/confirm', { workId: DEMO.work, checkItemId: DEMO.oxygen, value: 20.8 });
  return s.ok('POST', '/api/work/complete', { workId: DEMO.work });
}

/** 응답하지 않는다 (시간 초과 시험) */
export const HANG = Symbol('hang');

export interface FakeCompute {
  url: string;
  calls: string[];
  close(): Promise<void>;
}

/** 가짜 계산 서비스. handler 가 던지면 500 */
export async function fakeCompute(handler: (path: string, body: any) => unknown): Promise<FakeCompute> {
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const path = req.url ?? '/';
    calls.push(path);
    try {
      const out = await handler(path, raw ? JSON.parse(raw) : null);
      if (out === HANG) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out ?? null));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
