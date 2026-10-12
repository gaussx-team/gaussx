import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SCENE, type Scene } from '../config/scene.js';
import { DB, type Db, textArray } from '../db/db.js';
import { EventsService } from '../db/events.service.js';
import { type DrawingDto, loadDrawings, loadZones } from '../domain/views.js';
import { MediaService } from '../media/media.service.js';

export const DRAWING_KINDS = ['floor', 'pid', 'electrical', 'other'] as const;
const CAD_EXT = /\.(dwg|dxf|dgn)$/i;

export interface DrawingInput {
  title?: string;
  kind?: string;
  dwgNo?: string | null;
  revision?: string | null;
  zoneIds?: string[];
  equipment?: string[];
  fileName?: string;
  mime?: string | null;
  dataBase64?: string;
  note?: string | null;
}

/** 도면: 평면도 · P&ID · 단선도. 파일은 FILES_DIR, CAD 원본은 내려받기만 */
@Injectable()
export class DrawingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SCENE) private readonly scene: Scene,
    private readonly events: EventsService,
    private readonly media: MediaService,
  ) {}

  async list(base: string) {
    return { zones: await loadZones(this.db), drawings: await loadDrawings(this.db, base) };
  }

  async create(input: DrawingInput, base: string): Promise<DrawingDto> {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('도면 이름을 입력해 주세요');
    if (!input.dataBase64) throw new BadRequestException('파일을 골라 주세요');
    const fileName = input.fileName?.trim() || title;
    const kind = input.kind ?? 'other';
    if (!(DRAWING_KINDS as readonly string[]).includes(kind)) throw new BadRequestException(`알 수 없는 도면 종류예요: ${kind}`);
    const zoneIds = [...new Set(input.zoneIds ?? [])];
    for (const z of zoneIds) if (!this.scene.zones.some((x) => x.id === z)) throw new BadRequestException(`없는 구역이에요: ${z}`);
    const equipment = (input.equipment ?? []).map((e) => e.trim()).filter(Boolean);
    const buf = Buffer.from(input.dataBase64, 'base64');
    const mime = input.mime || 'application/octet-stream';

    const id = await this.db.tx(async (q) => {
      const file = await this.media.save(q, 'drawing', buf, { fileName, mime });
      const [d] = await q.query<{ id: number }>(
        `INSERT INTO drawing (site_id, title, kind, dwg_no, revision, equipment, file_name, mime, media_id, cad, note, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, ARRAY(SELECT jsonb_array_elements_text($6::jsonb)), $7, $8, $9, $10, $11, '담당자') RETURNING id`,
        [
          this.scene.site.id, title, kind, input.dwgNo?.trim() || null, input.revision?.trim() || 'REV.0', textArray(equipment),
          fileName, mime, file.id, CAD_EXT.test(fileName), input.note?.trim() || null,
        ],
      );
      for (const z of zoneIds) await q.query('INSERT INTO drawing_zone (drawing_id, zone_id) VALUES ($1, $2)', [d.id, z]);
      await this.events.log(q, { type: 'drawing.uploaded', actor: '담당자', text: `${title} (${fileName}) 등록`, drawing_id: d.id });
      return d.id;
    });
    return (await loadDrawings(this.db, base)).find((d) => d.id === id)!;
  }

  /** 올린 도면 파일. CAD 원본은 내려받기(attachment), 나머지는 브라우저에서 보기(inline) */
  async file(id: number): Promise<{ data: Buffer; mime: string; fileName: string; cad: boolean }> {
    const [row] = await this.db.query<{ path: string | null; mime: string; file_name: string; cad: boolean }>(
      'SELECT m.path, d.mime, d.file_name, d.cad FROM drawing d LEFT JOIN media m ON m.id = d.media_id WHERE d.id = $1',
      [id],
    );
    if (!row?.path) throw new NotFoundException('도면 파일을 찾을 수 없어요');
    return { data: await this.media.read(row.path), mime: row.mime, fileName: row.file_name, cad: row.cad };
  }
}
