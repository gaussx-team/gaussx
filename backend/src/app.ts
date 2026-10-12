import 'reflect-metadata';
import {
  BadRequestException,
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  type LogLevel,
  Module,
  type OnApplicationShutdown,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AlertsController } from './alerts/alerts.controller.js';
import { AlertsService } from './alerts/alerts.service.js';
import { ComputeClient } from './compute/compute.client.js';
import { ConfigSync } from './config/config-sync.service.js';
import { loadScene, SCENE } from './config/scene.js';
import { SETTINGS, type Settings } from './config/settings.js';
import { DbErrorFilter } from './db/db-error.filter.js';
import { DB, type Db, openDb } from './db/db.js';
import { EventsService } from './db/events.service.js';
import { SessionService } from './db/session.service.js';
import { DebugController } from './debug/debug.controller.js';
import { DispatchService } from './dispatch/dispatch.service.js';
import { DrawingsController } from './drawings/drawings.controller.js';
import { DrawingsService } from './drawings/drawings.service.js';
import { MediaController } from './media/media.controller.js';
import { MediaService } from './media/media.service.js';
import { Seeder } from './seed/seeder.js';
import { StateController } from './state/state.controller.js';
import { StateService } from './state/state.service.js';
import { TagsController } from './tags/tags.controller.js';
import { TagsService } from './tags/tags.service.js';
import { VERSION } from './version.js';
import { WorksController } from './works/works.controller.js';
import { WorksService } from './works/works.service.js';

@Injectable()
class DbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown() {
    await this.db.close();
  }
}

/** 앱 전체가 쓰는 것: 설정 · 씬 · DB · 회차 · 이벤트 · 파일 · 계산 서비스 · 로봇 출동 */
@Global()
@Module({})
class CoreModule {
  static forRoot(settings: Settings): DynamicModule {
    const shared = [EventsService, ConfigSync, Seeder, SessionService, MediaService, ComputeClient, DispatchService];
    return {
      module: CoreModule,
      providers: [
        { provide: SETTINGS, useValue: settings },
        { provide: SCENE, useFactory: () => loadScene(settings.sceneDir) },
        { provide: DB, useFactory: () => openDb(settings) },
        DbLifecycle,
        ...shared,
      ],
      exports: [SETTINGS, SCENE, DB, ...shared],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(settings: Settings): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(settings)],
      controllers: [
        StateController,
        TagsController,
        WorksController,
        AlertsController,
        DrawingsController,
        MediaController,
        DebugController,
      ],
      providers: [TagsService, WorksService, AlertsService, DrawingsService, StateService],
    };
  }
}

const API_DESCRIPTION = [
  'GaussX 백엔드. **프론트 목업 API(frontend/src/app/api)와 같은 계약** — 모양은 frontend/src/lib/types.ts, 목록은 docs/api.md.',
  '',
  '- JSON 키는 camelCase. 좌표는 바닥 m (3D 연동 전 4×3m 평면도와 같은 좌표)',
  '- 오류는 400 · 404 + `{ "message": "한국어 안내" }` (화면이 그대로 보여준다)',
  '- 데모 리셋은 기록을 지우지 않고 새 회차(스키마)를 만든다',
].join('\n');

function flatten(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}).map((m) => `${prefix}${e.property}: ${m}`),
    ...flatten(e.children ?? [], `${prefix}${e.property}.`),
  ]);
}

/** 앱 하나를 만든다 (main.ts · 테스트가 같이 쓴다). listen() 할 때 회차 준비 · 설정 반영 · 출동 복구가 돈다 */
export async function createApp(settings: Settings, logger: LogLevel[] | false = ['log', 'warn', 'error']) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(settings), {
    logger,
    forceCloseConnections: true,
    bodyParser: false,
  });
  // 도면 · 사진을 base64 · data URL 로 받으므로 JSON 한도를 넉넉히 (20MB 파일 ≈ 27MB base64)
  app.useBodyParser('json', { limit: '30mb' });
  // 프론트(Next, 3000)가 다른 주소에서 부른다. 프론트는 GET 에도 Content-Type 을 실어 보내서 매번 사전 요청(OPTIONS)이 붙는다
  // → 사전 요청 결과를 1시간 기억시켜 0.5초 폴링의 요청 수를 절반으로
  app.enableCors({ maxAge: 3600 });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false, // 프론트가 필드를 더 보내도 막지 않는다 (모르는 필드는 버린다)
      transform: true,
      exceptionFactory: (errors) => {
        const details = flatten(errors);
        return new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: `요청 형식이 잘못됐어요${details[0] ? `: ${details[0]}` : ''}`,
          details,
        });
      },
    }),
  );
  app.useGlobalFilters(new DbErrorFilter(app.getHttpAdapter()));
  app.useStaticAssets(settings.filesDir, { prefix: '/media' });

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('GaussX API').setDescription(API_DESCRIPTION).setVersion(VERSION).build(),
  );
  SwaggerModule.setup('docs', app, doc);
  return app;
}
