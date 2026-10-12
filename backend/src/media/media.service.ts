import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SETTINGS, type Settings } from '../config/settings.js';
import { DB, type Db, type Queryable } from '../db/db.js';

export type MediaKind = 'tag_photo' | 'tag_snapshot' | 'confirm_photo' | 'permit_pdf' | 'drawing';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_DRAWING_BYTES = 20 * 1024 * 1024;

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

function sniff(b: Buffer): string | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && /^hei|^mif/.test(b.subarray(8, 12).toString('latin1'))) {
    return 'heic';
  }
  return null;
}

/** JPEG · PNG 의 가로 · 세로. 모르는 형식이면 null */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
        i += m === 0xff ? 1 : 2; // 채움 바이트 · 길이 없는 표지
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** "data:image/jpeg;base64,…" → 내용 · 형식. data URL 이 아니면 null */
export function parseDataUrl(s: string): { buf: Buffer; mime: string } | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(s);
  if (!m) return null;
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { buf, mime: m[1] || 'application/octet-stream' };
}

export interface StoredFile {
  id: number;
  path: string;
}

/**
 * 파일 저장: FILES_DIR/<회차>/<sha256 앞 12자>.<확장자>, 행은 media (해시 = 증빙: 파일이 바뀌지 않았음).
 * 행은 부른 쪽 트랜잭션(q)에 넣는다. 트랜잭션이 취소되면 파일 하나가 고아로 남을 뿐이다.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(SETTINGS) private readonly s: Settings,
    @Inject(DB) private readonly db: Db,
  ) {}

  async save(q: Queryable, kind: MediaKind, buf: Buffer, o: { fileName?: string | null; mime?: string | null } = {}): Promise<StoredFile> {
    if (!buf.length) throw new BadRequestException('빈 파일이에요');
    const limit = kind === 'drawing' ? MAX_DRAWING_BYTES : MAX_PHOTO_BYTES;
    if (buf.length > limit) throw new BadRequestException(`파일은 ${limit / 1024 / 1024}MB까지 올릴 수 있어요`);
    const type = sniff(buf);
    const mime = o.mime || null;
    if (kind === 'permit_pdf' && type !== 'pdf') throw new BadRequestException('작업허가서는 PDF 파일만 받아요');
    if ((kind === 'confirm_photo' || kind === 'tag_snapshot' || kind === 'tag_photo') && type === 'pdf') {
      throw new BadRequestException('사진 파일을 올려 주세요');
    }
    if ((kind === 'confirm_photo' || kind === 'tag_snapshot') && !type && !mime?.startsWith('image/')) {
      throw new BadRequestException('사진 파일을 올려 주세요 (JPEG · PNG · WebP · HEIC)');
    }
    const ext =
      type ??
      (mime && MIME_EXT[mime]) ??
      (extname(o.fileName ?? '').slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin');
    const hash = sha256(buf);
    const path = await this.write(buf, hash, ext);
    const size = imageSize(buf);
    const [row] = await q.query<{ id: number }>(
      `INSERT INTO media (kind, path, sha256, file_name, mime, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [kind, path, hash, o.fileName ?? null, mime ?? (type ? MIME_EXT_REVERSE[type] : null), size?.width ?? null, size?.height ?? null],
    );
    return { id: row.id, path };
  }

  /** 다른 API 가 media_id 를 받을 때: 있는지, 종류가 맞는지 (FK 는 종류까지는 보지 않는다) */
  async requireKind(q: Queryable, id: number, kind: MediaKind, what: string): Promise<void> {
    const [row] = await q.query<{ kind: string }>('SELECT kind FROM media WHERE id = $1', [id]);
    if (!row) throw new BadRequestException(`없는 파일이에요: media ${id}`);
    if (row.kind !== kind) throw new BadRequestException(`${what} 파일이 아니에요: media ${id} 는 ${row.kind}`);
  }

  /** 저장한 파일 읽기 (FILES_DIR 밖은 읽지 않는다) */
  async read(path: string): Promise<Buffer> {
    const root = resolve(this.s.filesDir);
    const full = resolve(root, path);
    if (!full.startsWith(root + sep)) throw new BadRequestException('파일 경로가 올바르지 않아요');
    return readFile(full);
  }

  /** 같은 내용을 두 번 올려도 덮어쓰지 않는다: 이름 뒤에 -2, -3 … */
  private async write(buf: Buffer, hash: string, ext: string): Promise<string> {
    const session = this.db.schema ?? 'gx_none';
    const dir = join(this.s.filesDir, session);
    await mkdir(dir, { recursive: true });
    for (let n = 1; ; n++) {
      const name = `${hash.slice(0, 12)}${n > 1 ? `-${n}` : ''}.${ext}`;
      try {
        await writeFile(join(dir, name), buf, { flag: 'wx' });
        return `${session}/${name}`;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
  }
}

const MIME_EXT_REVERSE: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));
