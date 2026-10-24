import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadScene, SCENE, type Scene } from '../config/scene.js';
import { SETTINGS, type Settings } from '../config/settings.js';
import { DB, type Db } from '../db/db.js';

/** 관리자 화면 · 1m 보정으로 바꾼 값. 씬 값 위에 덮어쓴다 (없는 칸은 씬 값 그대로) */
export interface GatewayOverride {
  zone?: string;
  world?: [number, number, number];
  /** null = 이 수신기만의 값 없음 (공통 locate.ref_1m_dbm · 비콘이 알린 값을 쓴다) */
  ref1mDbm?: number | null;
}

/** .data/gateways.json — 씬(scan id)마다 수신기별로 */
interface GatewayFile {
  version: 1;
  scenes: Record<string, Record<string, GatewayOverride>>;
}

export interface GatewaySettingDto {
  id: string;
  label: string;
  zoneId: string;
  /** 바닥 m */
  x: number;
  y: number;
  z: number;
  /** 거리 어림에 쓰는 1m 세기. null = 공통 값 · 비콘이 알린 값 */
  ref1mDbm: number | null;
  /** 관리자 화면 · 1m 보정으로 바꾼 값이 있나 */
  custom: boolean;
  /** 씬 파일 값 (되돌리기) */
  defaults: { zoneId: string; x: number; y: number; z: number; ref1mDbm: number | null };
}

export type GatewayField = 'zone' | 'position' | 'ref1mDbm';

type Gateway = Scene['gateways'][number];

// + 0: -0 을 0 으로
const round1 = (v: number) => Math.round(v * 10) / 10 + 0;
const round2 = (v: number) => Math.round(v * 100) / 100 + 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validRef = (v: unknown) => v === null || (finite(v) && v < 0 && v >= -120);

function readFile(file: string): GatewayFile {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<GatewayFile>;
    return { version: 1, scenes: raw && typeof raw.scenes === 'object' && raw.scenes ? raw.scenes : {} };
  } catch {
    return { version: 1, scenes: {} }; // 아직 없거나 깨졌으면 씬 값만
  }
}

/** 저장된 값을 수신기에 덮어쓴다. 모르는 구역 · 잘못된 숫자는 건너뛴다 */
function apply(scene: Scene, g: Gateway, o: GatewayOverride) {
  if (typeof o.zone === 'string' && scene.zones.some((z) => z.id === o.zone)) g.zone = o.zone;
  if (Array.isArray(o.world) && o.world.length === 3 && o.world.every(finite)) g.world = [o.world[0], o.world[1], o.world[2]];
  if (o.ref1mDbm !== undefined && validRef(o.ref1mDbm)) g.ref1mDbm = o.ref1mDbm;
}

/** 씬을 읽을 때 한 번: 관리자 화면에서 바꿔 둔 값을 덮어쓴다 (그다음 설정 반영 · 회차 리셋이 이 값으로 앵커를 쓴다) */
export function applyGatewayFile(scene: Scene, file: string): Scene {
  const log = new Logger('Gateways');
  const saved = readFile(file).scenes[scene.scan.id] ?? {};
  for (const [id, o] of Object.entries(saved)) {
    const g = scene.gateways.find((x) => x.id === id);
    if (!g) {
      log.warn(`${file}: 씬에 없는 수신기라 건너뛰어요: ${id}`);
      continue;
    }
    apply(scene, g, o);
  }
  if (Object.keys(saved).length) log.log(`관리자 화면에서 바꾼 수신기 설정 ${Object.keys(saved).length}개를 씬 값 위에 썼어요 (${file})`);
  return scene;
}

/**
 * 비콘 수신기 설정 (관리자 화면 '수신기 배치' · 1m 보정): 자리 · 지키는 구역 · 1m 세기.
 * 씬 값(demo.json gateways)이 기본이고, 바꾼 값은 .data/gateways.json 에 남아 재시작 · 데모 리셋 뒤에도 그대로다.
 * 바꾸면 그 자리에서 씬(메모리)과 이번 회차의 앵커 행을 함께 고친다 — 구역 판정 · 레이더 · 관제 화면이 바로 따른다.
 */
@Injectable()
export class GatewaySettings {
  private readonly log = new Logger('Gateways');
  /** 씬 파일 값 (덮어쓰기 전) */
  private readonly defaults: Map<string, Gateway>;
  private file: GatewayFile;

  constructor(
    @Inject(SETTINGS) private readonly settings: Settings,
    @Inject(SCENE) private readonly scene: Scene,
    @Inject(DB) private readonly db: Db,
  ) {
    this.defaults = new Map(loadScene(settings.sceneDir).gateways.map((g) => [g.id, g]));
    this.file = readFile(settings.gatewaysFile);
  }

  list(): GatewaySettingDto[] {
    return this.scene.gateways.map((g) => this.view(g));
  }

  /** 바꾼다 (주지 않은 칸은 그대로). ref1mDbm: null = 이 수신기만의 값 없음 */
  async update(id: string, patch: { zoneId?: string; x?: number; y?: number; ref1mDbm?: number | null }): Promise<GatewaySettingDto> {
    const g = this.gatewayOrThrow(id);
    const o: GatewayOverride = { ...(this.saved()[id] ?? {}) };
    if (patch.zoneId !== undefined) {
      if (!this.scene.zones.some((z) => z.id === patch.zoneId)) throw new BadRequestException(`없는 구역이에요: ${patch.zoneId}`);
      o.zone = patch.zoneId;
    }
    if (patch.x !== undefined || patch.y !== undefined) {
      const x = patch.x ?? g.world[0];
      const y = patch.y ?? g.world[1];
      if (!finite(x) || !finite(y) || Math.abs(x) > 200 || Math.abs(y) > 200) {
        throw new BadRequestException(`수신기 자리는 -200 ~ 200 m 안이어야 해요: (${x}, ${y})`);
      }
      o.world = [round2(x), round2(y), g.world[2]];
    }
    if (patch.ref1mDbm !== undefined) {
      if (!validRef(patch.ref1mDbm)) throw new BadRequestException(`1m 세기는 -120 ~ 0 dBm 사이여야 해요: ${patch.ref1mDbm}`);
      o.ref1mDbm = patch.ref1mDbm === null ? null : round1(patch.ref1mDbm);
    }
    apply(this.scene, g, o);
    this.store(id, o);
    await this.syncAnchor(g);
    this.log.log(`${g.label}(${id}) 설정: 구역 ${g.zone} · 자리 (${g.world[0]}, ${g.world[1]}) · 1m ${g.ref1mDbm ?? '자동'}`);
    return this.view(g);
  }

  /** 씬 값으로 되돌린다 (fields 를 주면 그 칸만) */
  async reset(id: string, fields?: GatewayField[]): Promise<GatewaySettingDto> {
    const g = this.gatewayOrThrow(id);
    const d = this.defaults.get(id) ?? g;
    const o: GatewayOverride = { ...(this.saved()[id] ?? {}) };
    const only = fields?.length ? fields : null;
    const pick = (f: GatewayField) => !only || only.includes(f);
    if (pick('zone')) {
      delete o.zone;
      g.zone = d.zone;
    }
    if (pick('position')) {
      delete o.world;
      g.world = [d.world[0], d.world[1], d.world[2]];
    }
    if (pick('ref1mDbm')) {
      delete o.ref1mDbm;
      g.ref1mDbm = d.ref1mDbm;
    }
    this.store(id, Object.keys(o).length ? o : null);
    await this.syncAnchor(g);
    this.log.log(`${g.label}(${id}) 설정을 씬 값으로 되돌렸어요${only ? ` (${only.join(' · ')})` : ''}`);
    return this.view(g);
  }

  private gatewayOrThrow(id: string): Gateway {
    const g = this.scene.gateways.find((x) => x.id === id);
    if (!g) throw new BadRequestException(`등록되지 않은 수신기예요: ${id} (demo.json 의 gateways 를 확인해 주세요)`);
    return g;
  }

  private saved(): Record<string, GatewayOverride> {
    return this.file.scenes[this.scene.scan.id] ?? {};
  }

  private view(g: Gateway): GatewaySettingDto {
    const d = this.defaults.get(g.id) ?? g;
    return {
      id: g.id,
      label: g.label,
      zoneId: g.zone,
      x: g.world[0],
      y: g.world[1],
      z: g.world[2],
      ref1mDbm: g.ref1mDbm,
      custom: this.saved()[g.id] !== undefined,
      defaults: { zoneId: d.zone, x: d.world[0], y: d.world[1], z: d.world[2], ref1mDbm: d.ref1mDbm },
    };
  }

  /** 파일에 남긴다 (임시 파일에 쓰고 바꿔 끼운다 — 쓰다 꺼져도 깨지지 않게) */
  private store(id: string, o: GatewayOverride | null) {
    const sceneId = this.scene.scan.id;
    const scenes = { ...this.file.scenes, [sceneId]: { ...(this.file.scenes[sceneId] ?? {}) } };
    if (o) scenes[sceneId][id] = o;
    else delete scenes[sceneId][id];
    if (!Object.keys(scenes[sceneId]).length) delete scenes[sceneId];
    this.file = { version: 1, scenes };
    const path = this.settings.gatewaysFile;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, `${JSON.stringify(this.file, null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
  }

  /** 이번 회차의 앵커 행도 같게 (다음 회차는 설정 반영이 씬 값 = 덮어쓴 값으로 쓴다) */
  private async syncAnchor(g: Gateway) {
    await this.db.query('UPDATE anchor SET zone_id = $2, x = $3, y = $4, z = $5 WHERE id = $1', [g.id, g.zone, g.world[0], g.world[1], g.world[2]]);
  }
}
