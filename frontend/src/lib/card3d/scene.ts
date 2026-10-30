export type Point3 = [number, number, number];
export type MatrixRows = [number[], number[], number[], number[]];

export interface ScenePreset {
  label: string;
  matrix: MatrixRows;
}

export interface CardSceneConfig {
  version: 1;
  id: string;
  label: string;
  displayName?: string;
  coordinateSystem: string;
  model: { url: string; format: string; count: number; shDegree: number };
  background: Point3;
  horizontalFovDegrees: number;
  nearbyRadiusMeters: number;
  defaultWorkEquipment: string;
  contextEquipment: string[];
  anchors: { id: string; name: string; position: Point3 }[];
  presets: Record<string, ScenePreset>;
}

export interface SceneTag {
  id: number;
  title: string;
  hazard: string;
  substance?: string | null;
  official: boolean;
  status: string;
  version: number;
}

export interface SceneMarker {
  id: string;
  position: Point3;
  kind: "work" | "hazard";
  title: string;
  hazard: string;
  substance: string;
  official: boolean;
  distanceMeters: number;
}

const isPoint = (p: unknown): p is Point3 => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

export function validateSceneConfig(value: unknown): CardSceneConfig {
  const c = value as CardSceneConfig;
  if (!c || c.version !== 1 || !c.id || !c.model?.url || !isPoint(c.background)
    || !Number.isSafeInteger(c.model.count) || c.model.count < 1
    || !Number.isFinite(c.horizontalFovDegrees) || c.horizontalFovDegrees < 10 || c.horizontalFovDegrees > 140
    || !Number.isFinite(c.nearbyRadiusMeters) || c.nearbyRadiusMeters < 0
    || !Array.isArray(c.contextEquipment) || !Array.isArray(c.anchors) || !c.anchors.length
    || c.anchors.some((a) => !a.id || !isPoint(a.position))
    || new Set(c.anchors.map((a) => a.id)).size !== c.anchors.length
    || !c.anchors.some((a) => a.id === c.defaultWorkEquipment)
    || !c.presets?.work || !c.presets?.nearby
    || Object.values(c.presets).some((p) => !p.label || !Array.isArray(p.matrix) || p.matrix.length !== 4
      || p.matrix.some((r) => !Array.isArray(r) || r.length !== 4 || !r.every(Number.isFinite)))) {
    throw new Error("3D 장면 설정을 확인해 주세요.");
  }
  return c;
}

// A browser URL can point at local public/scenes or the eventual Release/drive download.
export function sceneModelUrl(config: CardSceneConfig, override?: string): string {
  const url = override?.trim() || config.model.url;
  if (/^\/(?!\/)/.test(url) || /^https?:\/\//i.test(url)) return url;
  throw new Error("장면 주소는 /scenes/ 경로 또는 HTTP(S) URL이어야 해요.");
}

export function equipmentIn(text: string, ids: string[]): string | null {
  return ids.find((id) => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Z0-9-])${escaped}($|[^A-Z0-9-])`, "i").test(text);
  }) ?? null;
}

export function assignedEquipment(config: CardSceneConfig, title: string, tags: SceneTag[]): string | null {
  const ids = config.anchors.map((a) => a.id);
  return equipmentIn(title, ids) ?? (tags.length === 1 ? equipmentIn(tags[0].title, ids) : null);
}

export const distance3d = (a: Point3, b: Point3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function scenePresetForWidth(config: CardSceneConfig, preset: string, width: number): string {
  return preset === "nearby" && width < 480 && config.presets.nearby_mobile ? "nearby_mobile" : preset;
}

export function markerShortName(marker: SceneMarker): string {
  return marker.kind === "work" ? `내 작업 ${marker.id}` : `${marker.substance.trim().split(/\s+/)[0] || "설비"} ${marker.id}`;
}

export function sceneMarkers(config: CardSceneConfig, equipment: string, workTags: SceneTag[], currentTags: SceneTag[]): SceneMarker[] {
  const workAnchor = config.anchors.find((a) => a.id === equipment);
  if (!workAnchor) return [];
  const ids = config.anchors.map((a) => a.id);
  const own = workTags.find((t) => equipmentIn(t.title, ids) === equipment);
  const markers: SceneMarker[] = [{
    id: equipment, position: workAnchor.position, kind: "work", title: own?.title ?? workAnchor.name,
    hazard: own?.hazard ?? "", substance: own?.substance ?? "", official: own?.official ?? false, distanceMeters: 0,
  }];
  for (const id of config.contextEquipment) {
    if (id === equipment) continue;
    const anchor = config.anchors.find((a) => a.id === id);
    const tag = currentTags.find((t) => t.status === "active" && equipmentIn(t.title, ids) === id);
    if (!anchor || !tag) continue;
    const distanceMeters = distance3d(workAnchor.position, anchor.position);
    if (distanceMeters > config.nearbyRadiusMeters) continue;
    markers.push({ id, position: anchor.position, kind: "hazard", title: tag.title, hazard: tag.hazard,
      substance: tag.substance ?? "", official: tag.official, distanceMeters });
  }
  return markers.sort((a, b) => a.kind === b.kind ? a.distanceMeters - b.distanceMeters : a.kind === "work" ? -1 : 1);
}

export interface ProjectedMarker { id: string; x: number; y: number; kind: "work" | "hazard" }
export interface MarkerBox extends ProjectedMarker { left: number; top: number; width: number; height: number }
export interface LabelRect { left: number; top: number; width: number; height: number }

// Keep the world projection fixed; only the label box moves. Omit boxes that cannot fit.
export function layoutMarkerBoxes(points: ProjectedMarker[], width: number, height: number,
  { reserved = [], presentation = false }: { reserved?: LabelRect[]; presentation?: boolean } = {}): MarkerBox[] {
  const result: MarkerBox[] = [];
  const compact = width < 480;
  const boxWidth = compact ? 110 : presentation ? 196 : 138;
  const boxHeight = compact ? 26 : presentation ? 66 : 46;
  if (width < 220 || height < 160) return result;
  const blocked = [
    { left: 0, top: 0, width, height: 44 },
    { left: 0, top: height - 36, width, height: 36 },
    ...reserved,
  ];
  const overlaps = (a: LabelRect, b: LabelRect) => a.left < b.left + b.width + 6 && a.left + a.width + 6 > b.left
    && a.top < b.top + b.height + 6 && a.top + a.height + 6 > b.top;
  for (const p of [...points].sort((a, b) => a.kind === b.kind ? 0 : a.kind === "work" ? -1 : 1)) {
    const candidates = [
      [p.x + 10, p.y - boxHeight - 6], [p.x - boxWidth - 10, p.y - boxHeight - 6],
      [p.x + 14, p.y + 10], [p.x - boxWidth - 14, p.y + 10],
      ...Array.from({ length: Math.ceil(height / (boxHeight + 8)) }, (_, i) => 50 + i * (boxHeight + 8))
        .flatMap((y) => [[10, y], [width - boxWidth - 10, y]]),
    ];
    for (const [rawX, rawY] of candidates) {
      const left = Math.max(10, Math.min(width - boxWidth - 10, rawX));
      const top = Math.max(50, Math.min(height - boxHeight - 42, rawY));
      const box = { ...p, left, top, width: boxWidth, height: boxHeight };
      if (blocked.some((b) => overlaps(box, b)) || result.some((b) => overlaps(box, b))) continue;
      result.push(box);
      break;
    }
  }
  return result;
}
